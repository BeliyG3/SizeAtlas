import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, isCmdError } from "../api/client";
import { ROOT_ID, type Roots, type TrashPreview } from "../api/types";
import { PurgeDialog } from "../features/trash/PurgeDialog";
import { trashReport, type Removal } from "../features/trash/text";
import { TrashDialog } from "../features/trash/TrashDialog";
import { useTrashRun } from "../features/trash/useTrashRun";
import { formatCount } from "../format";
import { useT } from "../i18n/react";
import { useSize } from "../settings/react";
import type { RootEntry } from "./roots";
import type { Selection } from "./selection";
import { availabilityNoteKey, runningJob, trashAvailability, trashNoteKey } from "./trashRule";
import { useTrashRefused } from "./useTrashRefused";

/** A request waiting for its confirmation. */
interface Asking {
  generation: number;
  root: string;
  rev: number;
  ids: number[];
  preview: TrashPreview;
  /** Rows of a clean-up list: the backend checks them again; `purge` deletes them for good. */
  how: Removal;
  /** One per question: a new request gets a new dialog, which starts at its first question. */
  serial: number;
}

/**
 * The marked rows of the table; `cleanup`: of a clean-up list, whose `selectedRow` is the selected
 * item when it is one of its rows.
 */
interface Marked {
  ids: readonly number[];
  cleanup: boolean;
  selectedRow: number | null;
}

interface Args {
  roots: Roots;
  entries: readonly RootEntry[];
  selection: Selection | null;
  push: (text: string) => void;
  /** Shows the tree without the removed items at once, even while a first scan paces updates. */
  onTrashed: () => void;
  onError: (e: unknown) => void;
  errorText: (e: unknown) => string;
}

/**
 * Everything about removing items, kept out of the app shell: the marked rows of the table, the
 * preview for the confirmation, the request (one at a time for now), its
 * progress (`useTrashRun`) and its report. Items go to the trash; rows of a clean-up list also
 * for good (`onPurge`), after the two questions of `PurgeDialog`. `root` is the root it removes
 * items of: no refresh there meanwhile. `onTrash`, `onPurge` and `onMarks` are stable, for the
 * memoized views. `menuTrash` is what Scan › Move to the trash and Delete outside the table and
 * the tree do: the marked rows, else the selected item (never a root); null while there is none,
 * a request runs or a scan still lists one of them (`trashNote` then says why). The backend
 * refuses the same items.
 */
export function useTrash({ roots, entries, selection, push, onTrashed, onError, errorText }: Args) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState<Asking | null>(null);
  const size = useSize();
  const running = useTrashRun(onError);
  const busy = running.root !== null;
  const [marked, setMarked] = useState<Marked>({ ids: [], cleanup: false, selectedRow: null });
  const questions = useRef(0);
  const job = useMemo(() => runningJob(roots), [roots]);

  /** Asks to remove `ids` of the tree with `generation` `how`, showing what would go. */
  const ask = (generation: number, ids: readonly number[], how: Removal) => {
    const entry = entries.find((e) => e.summary?.generation === generation);
    if (!entry?.summary || busy || ids.length === 0) return;
    const { rev } = entry.summary;
    const list = [...ids];
    api.trashPreview(generation, rev, list).then(
      // One question at a time: one asked at the same moment does not replace it.
      (preview) => {
        const serial = ++questions.current;
        const next = { generation, root: entry.root, rev, ids: list, preview, how, serial };
        setAsking((shown) => shown ?? next);
      },
      // A preview is busy only while a scan still lists an item: say so as the menus do.
      (e: unknown) => {
        if (isCmdError(e) && e.code === "Busy") push(t(trashNoteKey(list.length)));
        else onError(e);
      },
    );
  };
  const confirm = () => {
    if (!asking) return;
    setAsking(null);
    // A question that came while another request ran: that one's Stop must stay its own.
    if (busy) {
      push(t("trash.busy"));
      return;
    }
    const { generation, root, rev, ids, preview, how } = asking;
    const request = running.start({ generation, root, ids, preview, purge: how === "purge" });
    const removal =
      how === "purge"
        ? api.deleteForGood(request, generation, rev, ids)
        : api.trash(request, generation, rev, ids, how === "cleanup");
    removal
      .then((result) => {
        // Stopped while it waited: nothing was tried, nothing to report.
        if (result.cancelled) return;
        onTrashed();
        const count = (n: number) => formatCount(n, lang);
        for (const text of trashReport(result, preview, t, errorText, count, size, how)) push(text);
      }, onError)
      .finally(() => running.end(request));
  };
  // The views are memoized: stable handlers call the latest `ask`.
  const latest = useRef(ask);
  useLayoutEffect(() => {
    latest.current = ask;
  });
  const onTrash = useCallback(
    (generation: number, ids: readonly number[], cleanup = false) =>
      latest.current(generation, ids, cleanup ? "cleanup" : "trash"),
    [],
  );
  const onPurge = useCallback(
    (generation: number, ids: readonly number[]) => latest.current(generation, ids, "purge"),
    [],
  );
  const onMarks = useCallback(
    (ids: readonly number[], cleanup = false, selectedRow: number | null = null) =>
      setMarked({ ids, cleanup, selectedRow }),
    [],
  );

  const generation = selection?.generation ?? null;
  const selected = selection && selection.id !== ROOT_ID ? [selection.id] : [];
  const targets = marked.ids.length > 0 ? marked.ids : selected;
  const rev = entries.find((e) => e.summary?.generation === generation)?.summary?.rev ?? null;
  const refused = useTrashRefused(job, generation, rev, targets);
  const available = trashAvailability(busy, job !== null, refused);
  // Rows of a clean-up list go with its checks: the marked ones, else the selected item when it
  // is one of its rows. Anything else (such as the list's own folder) as before.
  const rows = marked.ids.length > 0 || (selection !== null && marked.selectedRow === selection.id);
  const how = marked.cleanup && rows ? "cleanup" : "trash";
  const menuTrash =
    generation !== null && targets.length > 0 && available.enabled
      ? () => ask(generation, targets, how)
      : null;
  // One item is the selected one, unless it is a single marked row (its kind is not known).
  const isDir = marked.ids.length > 0 ? undefined : selection?.id === selection?.folder;
  const noteKey = targets.length > 0 ? availabilityNoteKey(available, targets.length, isDir) : null;
  const trashNote = noteKey && t(noteKey);
  const close = () => setAsking(null);
  let dialog: ReactNode = null;
  if (asking?.how === "purge")
    dialog = (
      <PurgeDialog
        key={asking.serial}
        preview={asking.preview}
        onConfirm={confirm}
        onClose={close}
      />
    );
  else if (asking)
    dialog = (
      <TrashDialog
        preview={asking.preview}
        cleanup={asking.how === "cleanup"}
        onConfirm={confirm}
        onClose={close}
      />
    );
  return {
    busy,
    root: running.root,
    moving: running.moving,
    status: running.status,
    window: running.window,
    job,
    onTrash,
    onPurge,
    onMarks,
    menuTrash,
    trashNote,
    dialog,
  };
}

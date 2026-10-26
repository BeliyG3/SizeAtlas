import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, isCmdError } from "../api/client";
import { ROOT_ID, type Roots, type TrashPreview } from "../api/types";
import { PurgeDialog } from "../features/trash/PurgeDialog";
import { isRemoving as removesAny } from "../features/trash/runs";
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
interface Question {
  generation: number;
  root: string;
  rev: number;
  ids: number[];
  preview: TrashPreview;
  /** Rows of a clean-up list: the backend checks them again; `purge` deletes them for good. */
  how: Removal;
}

interface Asking extends Question {
  /** One per question: a new request gets a new dialog, which starts at its first question. */
  serial: number;
}

const isStale = (e: unknown) => isCmdError(e) && e.code === "StaleId";

/** The current revision of the tree with `generation` and the preview of `ids` at it. */
async function fresh(generation: number, ids: number[]) {
  const { rev } = await api.getSummary(generation);
  return { rev, preview: await api.trashPreview(generation, rev, ids) };
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
 * preview for the confirmation, the requests (any number: the backend queues them per drive), their
 * progress (`useTrashRun`) and their reports. Items go to the trash; rows of a clean-up list also
 * for good (`onPurge`), after the two questions of `PurgeDialog`. `roots` are the roots requests
 * remove items of: no refresh there meanwhile. `onTrash`, `onPurge` and `onMarks` are stable, for the
 * memoized views. `menuTrash` is what Scan › Move to the trash and Delete outside the table and
 * the tree do: the marked rows, else the selected item (never a root); null while there is none,
 * a request already has one of them or a scan still lists one of them (`trashNote` then says why).
 * The backend refuses the same items.
 */
export function useTrash({ roots, entries, selection, push, onTrashed, onError, errorText }: Args) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState<Asking | null>(null);
  const size = useSize();
  const running = useTrashRun(onError, push);
  /** Whether a request, started or waiting, already has one of `ids` of the tree with `generation`. */
  const isRemoving = (generation: number, ids: readonly number[]) =>
    removesAny(running.moving, generation, ids);
  const [marked, setMarked] = useState<Marked>({ ids: [], cleanup: false, selectedRow: null });
  const questions = useRef(0);
  const job = useMemo(() => runningJob(roots), [roots]);

  /** Opens the dialog for `next`, unless one is open: one question at a time. */
  // ponytail: a question that comes while another is open is dropped; a queue of questions if
  // that ever matters.
  const show = (next: Question) => {
    const serial = ++questions.current;
    setAsking((shown) => shown ?? { ...next, serial });
  };

  /** Asks to remove `ids` of the tree with `generation` `how`, showing what would go. */
  const ask = (generation: number, ids: readonly number[], how: Removal) => {
    const entry = entries.find((e) => e.summary?.generation === generation);
    if (!entry?.summary || ids.length === 0) return;
    if (isRemoving(generation, ids)) {
      push(t("trash.already"));
      return;
    }
    const { rev } = entry.summary;
    const list = [...ids];
    api
      .trashPreview(generation, rev, list)
      .then((preview) => ({ rev, preview }))
      // A request of the root ended after this view: preview at the revision it left.
      .catch((e: unknown) => (isStale(e) ? fresh(generation, list) : Promise.reject(e)))
      .then(
        ({ rev, preview }) => show({ generation, root: entry.root, rev, ids: list, preview, how }),
        // A preview is busy only while a scan still lists an item: say so as the menus do.
        (e: unknown) => {
          if (isCmdError(e) && e.code === "Busy") push(t(trashNoteKey(list.length)));
          else onError(e);
        },
      );
  };
  /** Sends the confirmed `asked`; refused as out of date, it is looked at again (`retry`). */
  const send = (asked: Question) => {
    const { generation, root, rev, ids, preview, how } = asked;
    const request = running.start({ generation, root, ids, preview, purge: how === "purge" });
    const removal =
      how === "purge"
        ? api.deleteForGood(request, generation, rev, ids)
        : api.trash(request, generation, rev, ids, how === "cleanup");
    removal
      .then(
        (result) => {
          // Stopped while it waited: nothing was tried, nothing to report.
          if (result.cancelled) return;
          onTrashed();
          const count = (n: number) => formatCount(n, lang);
          for (const text of trashReport(result, preview, t, errorText, count, size, how))
            push(text);
        },
        (e: unknown) => (isStale(e) ? retry(asked) : onError(e)),
      )
      // After a retry: its rows stay marked until the next request has them.
      .finally(() => running.end(request));
  };
  /**
   * `asked` was refused as out of date: another request of its root ended while the dialog was
   * open. Previewed again, the same count and size go at once; anything else is asked again,
   * never sent unseen. Items gone (or a tree compacted meanwhile): nothing was removed, say so.
   */
  const retry = (asked: Question) =>
    fresh(asked.generation, asked.ids)
      .then(({ rev, preview }) => {
        // The same revision would be refused again: no loop.
        if (rev === asked.rev) throw new Error("still out of date");
        const same = preview.count === asked.preview.count && preview.size === asked.preview.size;
        if (same) send({ ...asked, rev, preview });
        else show({ ...asked, rev, preview });
      })
      .catch((e: unknown) => {
        push(t("trash.notRemoved"));
        // The view is out of date too: the roots are read again.
        if (isStale(e)) onError(e);
      });
  const confirm = () => {
    if (!asking) return;
    setAsking(null);
    // The preview may have come after another request took these items.
    if (isRemoving(asking.generation, asking.ids)) {
      push(t("trash.already"));
      return;
    }
    send(asking);
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
  const available = trashAvailability(
    generation !== null && isRemoving(generation, targets),
    job !== null,
    refused,
  );
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
    roots: running.roots,
    isRemoving,
    moving: running.moving,
    status: running.status,
    windows: running.windows,
    job,
    onTrash,
    onPurge,
    onMarks,
    menuTrash,
    trashNote,
    dialog,
  };
}

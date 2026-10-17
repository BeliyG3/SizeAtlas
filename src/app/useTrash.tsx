import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, isCmdError } from "../api/client";
import { ROOT_ID, type Roots, type TrashPreview } from "../api/types";
import { trashReport } from "../features/trash/text";
import { TrashDialog } from "../features/trash/TrashDialog";
import { formatCount } from "../format";
import { useT } from "../i18n/react";
import type { RootEntry } from "./roots";
import type { Selection } from "./selection";
import { runningJob, trashAvailability, trashNoteKey } from "./trashRule";
import { useTrashRefused } from "./useTrashRefused";

/** A trash request waiting for its confirmation. */
interface Asking {
  generation: number;
  rev: number;
  ids: number[];
  preview: TrashPreview;
}

interface Args {
  roots: Roots;
  entries: readonly RootEntry[];
  selection: Selection | null;
  push: (text: string) => void;
  /** Shows the tree without the trashed items at once, even while a first scan paces updates. */
  onTrashed: () => void;
  onError: (e: unknown) => void;
  errorText: (e: unknown) => string;
}

/**
 * Everything about moving items to the trash, kept out of the app shell: the marked rows of the
 * table, the preview for the confirmation, the request (one at a time) and its report.
 * `onTrash` and `onMarks` are stable, for the memoized views. `menuTrash` is what Scan › Move to
 * the trash and Delete outside the table and the tree do: the marked rows, else the selected
 * item (never a root); null while there is none, a trash runs or a scan still lists one of them
 * (`trashNote` then says why). The backend refuses the same items.
 */
export function useTrash({ roots, entries, selection, push, onTrashed, onError, errorText }: Args) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [marked, setMarked] = useState<readonly number[]>([]);
  const job = useMemo(() => runningJob(roots), [roots]);

  /** Asks to move `ids` of the tree with `generation` to the trash, showing what would go. */
  const ask = (generation: number, ids: readonly number[]) => {
    const entry = entries.find((e) => e.summary?.generation === generation);
    if (!entry?.summary || busy || ids.length === 0) return;
    const { rev } = entry.summary;
    const list = [...ids];
    api.trashPreview(generation, rev, list).then(
      (preview) => setAsking({ generation, rev, ids: list, preview }),
      // A preview is busy only while a scan still lists an item: say so as the menus do.
      (e: unknown) => {
        if (isCmdError(e) && e.code === "Busy") push(t(trashNoteKey(list.length)));
        else onError(e);
      },
    );
  };
  const confirm = () => {
    if (!asking) return;
    const { generation, rev, ids } = asking;
    setAsking(null);
    setBusy(true);
    api
      .trash(generation, rev, ids)
      .then((result) => {
        onTrashed();
        for (const text of trashReport(result, t, errorText, (n) => formatCount(n, lang))) {
          push(text);
        }
      }, onError)
      .finally(() => setBusy(false));
  };
  // The views are memoized: one stable handler calls the latest `ask`.
  const latest = useRef(ask);
  useLayoutEffect(() => {
    latest.current = ask;
  });
  const onTrash = useCallback(
    (generation: number, ids: readonly number[]) => latest.current(generation, ids),
    [],
  );

  const generation = selection?.generation ?? null;
  const selected = selection && selection.id !== ROOT_ID ? [selection.id] : [];
  const targets = marked.length > 0 ? marked : selected;
  const rev = entries.find((e) => e.summary?.generation === generation)?.summary?.rev ?? null;
  const refused = useTrashRefused(job, generation, rev, targets);
  const available = trashAvailability(busy, job !== null, refused);
  const menuTrash =
    generation !== null && targets.length > 0 && available.enabled
      ? () => ask(generation, targets)
      : null;
  // One item is the selected one, unless it is a single marked row (its kind is not known).
  const isDir = marked.length > 0 ? undefined : selection?.id === selection?.folder;
  const trashNote =
    targets.length > 0 && available.reason ? t(trashNoteKey(targets.length, isDir)) : null;
  const dialog: ReactNode = asking && (
    <TrashDialog preview={asking.preview} onConfirm={confirm} onClose={() => setAsking(null)} />
  );
  return { busy, job, onTrash, onMarks: setMarked, menuTrash, trashNote, dialog };
}

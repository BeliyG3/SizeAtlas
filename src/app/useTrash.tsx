import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { ROOT_ID, type Roots, type TrashPreview } from "../api/types";
import { trashReport } from "../features/trash/text";
import { TrashDialog } from "../features/trash/TrashDialog";
import { formatCount } from "../format";
import { useT } from "../i18n/react";
import { busyRoots, type RootEntry } from "./roots";
import type { Selection } from "./selection";

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
  onError: (e: unknown) => void;
  errorText: (e: unknown) => string;
}

/**
 * Everything about moving items to the trash, kept out of the app shell: the marked rows of the
 * table, the preview for the confirmation, the request (one at a time) and its report.
 * `onTrash` and `onMarks` are stable, for the memoized views. `menuTrash` is what Scan › Move to
 * the trash and Delete outside the table and the tree do: the marked rows, else the selected
 * item (never a root); null while there is none or a trash runs.
 */
export function useTrash({ roots, entries, selection, push, onError, errorText }: Args) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [marked, setMarked] = useState<readonly number[]>([]);
  const busyAt = useMemo(() => busyRoots(roots), [roots]);

  /** Asks to move `ids` of the tree with `generation` to the trash, showing what would go. */
  const ask = (generation: number, ids: readonly number[]) => {
    const entry = entries.find((e) => e.summary?.generation === generation);
    if (!entry?.summary || busy || ids.length === 0) return;
    if (busyAt.has(entry.root)) {
      onError({ code: "Busy" });
      return;
    }
    const { rev } = entry.summary;
    const list = [...ids];
    api
      .trashPreview(generation, rev, list)
      .then((preview) => setAsking({ generation, rev, ids: list, preview }), onError);
  };
  const confirm = () => {
    if (!asking) return;
    const { generation, rev, ids } = asking;
    setAsking(null);
    setBusy(true);
    api
      .trash(generation, rev, ids)
      .then((result) => {
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
  const menuTrash =
    generation !== null && targets.length > 0 && !busy ? () => ask(generation, targets) : null;
  const dialog: ReactNode = asking && (
    <TrashDialog preview={asking.preview} onConfirm={confirm} onClose={() => setAsking(null)} />
  );
  return { busy, busyRoots: busyAt, onTrash, onMarks: setMarked, menuTrash, dialog };
}

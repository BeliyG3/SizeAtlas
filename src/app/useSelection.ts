import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { readStored, writeStored } from "../settings/storage";
import { LAST_ROOT_KEY, type RootEntry } from "./roots";
import { followEntries, resolveSelection, rootSelection, type Selection } from "./selection";
import { useHistory } from "./useHistory";

/**
 * One selected node across all roots (see `resolveSelection`); its root is remembered. When the
 * chosen root leaves the list (closed, forgotten, its first scan cancelled or failed), the
 * selection moves to its neighbour. The folders it chooses go into the back and forward history.
 */
export function useSelection(
  entries: readonly RootEntry[],
  onFail: (e: unknown) => void,
  restoring: boolean,
) {
  const [chosen, setChosen] = useState<Selection | null>(() => {
    const root = readStored(LAST_ROOT_KEY);
    return root ? rootSelection(root) : null;
  });
  // Adjusted while rendering, as React recommends for state that follows a prop.
  const [listed, setListed] = useState(entries);
  if (listed !== entries) {
    setListed(entries);
    const next = followEntries(chosen, listed, entries);
    if (next !== chosen) setChosen(next);
  }
  const chosenRoot = chosen?.root;
  useEffect(() => {
    if (chosenRoot !== undefined) writeStored(LAST_ROOT_KEY, chosenRoot);
  }, [chosenRoot]);
  const selection = useMemo(
    () => resolveSelection(chosen, entries, restoring),
    [chosen, entries, restoring],
  );
  // Read by the stable callbacks below.
  const entriesRef = useRef(entries);
  useLayoutEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  // Only the latest choice may land when the parent of a file arrives late.
  const latest = useRef(0);

  const jump = useCallback((next: Selection) => {
    latest.current++;
    setChosen(next);
  }, []);
  const history = useHistory(selection, entries, jump);
  const { record } = history;
  const choose = useCallback(
    (next: Selection) => {
      record(next);
      jump(next);
    },
    [record, jump],
  );

  const selectRoot = useCallback(
    (root: string) => {
      const entry = entriesRef.current.find((e) => e.root === root);
      choose(rootSelection(root, entry?.summary?.generation ?? null));
    },
    [choose],
  );

  /** Selects a node of the tree with `generation`; a file chosen without its parent gets it from its crumbs. */
  const selectNode = useCallback(
    (generation: number, id: number, isDir: boolean, parent?: number) => {
      const root = entriesRef.current.find((e) => e.summary?.generation === generation)?.root;
      if (root === undefined) return;
      if (isDir) {
        choose({ root, generation, id, folder: id });
        return;
      }
      if (parent !== undefined) {
        choose({ root, generation, id, folder: parent });
        return;
      }
      const request = ++latest.current;
      api.getCrumbs(generation, id).then((crumbs) => {
        const folder = crumbs[crumbs.length - 2];
        if (request === latest.current && folder)
          choose({ root, generation, id, folder: folder.id });
      }, onFail);
    },
    [choose, onFail],
  );

  // After a change of the tree (a refresh, a trash) a selected node that is gone gives way to
  // its nearest live ancestor. At revision 0 nothing is gone.
  const rev = entries.find((e) => e.root === selection?.root)?.summary?.rev ?? 0;
  useEffect(() => {
    if (!selection || selection.generation === null || rev === 0) return;
    const { root, generation, id } = selection;
    let live = true;
    api.getLiveAncestor(generation, id).then((alive) => {
      if (live && alive !== id)
        jump({ root, generation, id: alive, folder: alive, fallbackOf: id });
    }, onFail);
    return () => {
      live = false;
    };
  }, [selection, rev, jump, onFail]);

  return { selection, selectRoot, selectNode, history };
}

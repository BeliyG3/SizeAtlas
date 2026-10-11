import { useCallback, useState } from "react";

/** The selected node and its folder; every choice makes a new object, even of the same node. */
export interface ListSelection {
  readonly id: number;
  readonly folder: number;
  /** A change removed this node and the selection fell back (see `Selection.fallbackOf`). */
  readonly fallbackOf?: number;
}

/** The folder a flat list is made for, and what it follows. */
export interface ListBase {
  readonly base: number;
  /** The selection when `base` was last decided. */
  readonly selection: ListSelection;
  /** An item picked in the list: selecting it moves the current folder, not the list. */
  readonly picked: number | null;
}

/**
 * The list follows every new selection (tree, crumbs, charts, Back, the folder table) to its
 * folder, unless the selection is an item picked in the list, or a fallback after a change that
 * removed something other than the list's own folder. While no list is shown (`listing` false),
 * it simply is the current folder, so a list opened later starts there.
 */
export function followSelection(
  state: ListBase,
  selection: ListSelection,
  listing: boolean,
): ListBase {
  if (selection === state.selection && (listing || state.base === selection.folder)) return state;
  const picked = listing && selection.id === state.picked;
  const fallback =
    listing && selection.fallbackOf !== undefined && selection.fallbackOf !== state.base;
  return { base: picked || fallback ? state.base : selection.folder, selection, picked: null };
}

/** The folder a flat list covers, for the current `selection`; `listing`: a list is shown. */
export function useListBase(selection: ListSelection, listing: boolean) {
  const [state, setState] = useState<ListBase>({
    base: selection.folder,
    selection,
    picked: null,
  });
  // Adjusted while rendering, as React recommends for state that follows a prop.
  const next = followSelection(state, selection, listing);
  if (next !== state) setState(next);
  /** Call before selecting an item of the list. */
  const pick = useCallback((item: number) => setState((s) => ({ ...s, picked: item })), []);
  /** Makes the list for `dir` (double click, Enter, Backspace); call before selecting `dir`. */
  const enter = useCallback(
    (dir: number) => setState((s) => ({ ...s, base: dir, picked: dir })),
    [],
  );
  return { base: next.base, pick, enter };
}

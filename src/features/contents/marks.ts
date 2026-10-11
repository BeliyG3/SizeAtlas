/**
 * Rows marked in one table for an action (Delete, the item menu). Marks belong to one listing and
 * one selection: another folder, mode, order, revision of the tree or a node selected elsewhere
 * starts without any, so marks never hide a selection made elsewhere. A plain click or arrow on a
 * folder row marks that folder while the selected file stays: an action takes the marked rows, as
 * in Explorer.
 *
 * A plain click or arrow key marks one row, Ctrl+click (Cmd+click on macOS) adds or removes one,
 * Shift+click and Shift+arrows mark the rows from the anchor (the row of the last plain or Ctrl
 * click; without one, the cursor row) to this one, and Ctrl+A marks every loaded row. Rows not
 * loaded yet are left out.
 */
export interface Marks {
  /** The listing and selection the marks belong to (see `marksKey`). */
  readonly key: string;
  /** Item ids of the marked rows. */
  readonly ids: ReadonlySet<number>;
  /** Row Shift ranges start from; null before any click. */
  readonly anchor: number | null;
}

/** How a click or a key changes the marks. */
export type MarkHow = "one" | "toggle" | "range";

/** Item id of row `index`, if it is loaded. */
export type IdAt = (index: number) => number | undefined;

const NONE: ReadonlySet<number> = new Set();

/** Key of the marks of `listing` (folder, mode, order, revision) while `selectedId` is selected. */
export const marksKey = (listing: string, selectedId: number) => `${listing}:${selectedId}`;

export const noMarks = (key: string): Marks => ({ key, ids: NONE, anchor: null });

/** The marks under `key`: none when `marks` belong to another listing or selection. */
export const marksFor = (marks: Marks, key: string): Marks =>
  marks.key === key ? marks : noMarks(key);

/** Shift extends from the anchor, Ctrl (Cmd on macOS) adds or removes; else one row. */
export function markHow(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): MarkHow {
  if (e.shiftKey) return "range";
  return e.ctrlKey || e.metaKey ? "toggle" : "one";
}

/**
 * Marks row `index` the way `how` says. A range starts at the anchor, else at `from` (the
 * cursor row before the move).
 */
export function mark(
  marks: Marks,
  how: MarkHow,
  index: number,
  idAt: IdAt,
  from: number = index,
): Marks {
  if (how === "range") {
    const start = marks.anchor ?? from;
    const ids = new Set<number>();
    for (let i = Math.min(start, index); i <= Math.max(start, index); i++) {
      const id = idAt(i);
      if (id !== undefined) ids.add(id);
    }
    return { key: marks.key, ids, anchor: start };
  }
  const ids = new Set(how === "toggle" ? marks.ids : NONE);
  const id = idAt(index);
  if (id !== undefined) {
    if (how === "toggle" && ids.has(id)) ids.delete(id);
    else ids.add(id);
  }
  return { key: marks.key, ids, anchor: index };
}

/**
 * Ctrl+A: every loaded row of the `count`.
 * ponytail: in a huge folder a Shift range and Ctrl+A take the loaded pages only; marking by
 * listing position instead of loaded ids would cover the rest.
 */
export function markAll(marks: Marks, count: number, idAt: IdAt): Marks {
  const ids = new Set<number>();
  for (let i = 0; i < count; i++) {
    const id = idAt(i);
    if (id !== undefined) ids.add(id);
  }
  return { key: marks.key, ids, anchor: marks.anchor };
}

/** What an action acts on: the marked items, else the item under the cursor. */
export function targets(marks: Marks, cursorId: number | undefined): number[] {
  if (marks.ids.size > 0) return [...marks.ids];
  return cursorId === undefined ? [] : [cursorId];
}

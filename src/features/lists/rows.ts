import type { List, ListItem, ListKind } from "../../api/types";
import type { MenuTarget } from "../menu/ItemMenu";
import type { ColumnId } from "../contents/columns";
import { isCleanupMode } from "./modes";

/** The backend returns at most this many items of a list. */
export const LIST_LIMIT = 1000;

/**
 * The message of a list without rows: "grew most" says why it has none; a search says it found
 * nothing; a clean-up list that there is nothing to clean.
 */
export function emptyListKey(kind: ListKind, list: Pick<List, "baselineAt" | "baselinePending">) {
  if (kind === "search") return "search.none";
  if (isCleanupMode(kind)) return "cleanup.none";
  if (kind !== "grewMost" || list.baselineAt !== null) return "lists.empty";
  return list.baselinePending ? "lists.baselinePending" : "lists.noBaseline";
}

/** A header sort of a flat list. */
export interface ListSort {
  readonly column: ColumnId;
  readonly descending: boolean;
}

const text = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The change a list sorts by: a new item grows by its whole size, none counts as 0; NaN if unknown. */
function changeOf(item: ListItem): number {
  const change = item.change;
  if (change === "unknown") return Number.NaN;
  return change === "new" ? item.size : (change?.delta ?? 0);
}

/** Values of the numeric columns; NaN (an unknown change) sorts last both ways. */
const NUMBERS: Partial<Record<ColumnId, (item: ListItem) => number>> = {
  len: (i) => i.len,
  size: (i) => i.size,
  percent: (i) => i.size,
  before: (i) => i.before ?? 0,
  change: changeOf,
  files: (i) => i.files,
  folders: (i) => i.folders,
  dirs: (i) => i.dirs,
  modified: (i) => i.modified,
};

/** `a` before `b` (negative) in ascending order of `column`. */
function compare(a: ListItem, b: ListItem, column: ColumnId): number {
  if (column === "name") return text.compare(a.name, b.name);
  if (column === "path") return text.compare(a.folder, b.folder) || text.compare(a.name, b.name);
  const value = NUMBERS[column];
  return value ? value(a) - value(b) : 0;
}

/** `items` sorted by `sort` (null: as they came); equal items keep the order of the list. */
export function sortRows(items: readonly ListItem[], sort: ListSort | null): readonly ListItem[] {
  if (!sort) return items;
  const sign = sort.descending ? -1 : 1;
  const value = NUMBERS[sort.column];
  const unknown = (item: ListItem) => (value && Number.isNaN(value(item)) ? 1 : 0);
  return [...items].sort(
    (a, b) => unknown(a) - unknown(b) || sign * (compare(a, b, sort.column) || 0),
  );
}

/** The sort a list starts with: Grew most by the change, the largest growth first; else as it came. */
export const defaultListSort = (kind: ListKind): ListSort | null =>
  kind === "grewMost" ? { column: "change", descending: true } : null;

/**
 * Id of a row for what reaches the tree (selection, marks, details); none for a deleted folder,
 * whose id is not a node.
 */
export const liveId = (item: ListItem | undefined): number | undefined =>
  item && !item.deleted ? item.id : undefined;

/** A header click: the same column flips; another starts descending, names and paths ascending. */
export function nextListSort(current: ListSort | null, column: ColumnId): ListSort {
  if (current?.column === column) return { column, descending: !current.descending };
  return { column, descending: column !== "name" && column !== "path" };
}

const DAY_SECONDS = 24 * 60 * 60;

/** A scan (`scannedAt` in seconds) made more than a day before `nowMs`: its clean-up list may be out of date. */
export const staleScan = (scannedAt: number, nowMs: number): boolean =>
  scannedAt > 0 && nowMs / 1000 - scannedAt > DAY_SECONDS;

/**
 * What a context menu needs to know of a row of a clean-up list: that it is one (the trash
 * dialogs differ) and the command of its tool, if any. Rows of other lists are plain.
 */
export const menuCleanup = (
  item: ListItem,
  kind: ListKind,
): Pick<MenuTarget, "cleanup" | "command"> =>
  isCleanupMode(kind)
    ? { cleanup: true, ...(item.reason?.command ? { command: item.reason.command } : {}) }
    : {};

import type { DupCopy, DupGroup } from "../../api/duplicates";
import { gridSpec } from "../columns/grid";

export type GroupColumn = "name" | "copies" | "size" | "free";
export type CopyColumn = "path" | "modified" | "root" | "marks";

const LABELS: Readonly<Record<GroupColumn | CopyColumn, string>> = {
  name: "col.name",
  copies: "dup.colCopies",
  size: "col.size",
  free: "dup.colFree",
  path: "col.path",
  modified: "col.modified",
  root: "dup.colRoot",
  marks: "dup.colMarks",
};
const labelKey = (id: GroupColumn | CopyColumn) => LABELS[id];

/** The groups: the name (with the thumbnail), copies, size of a copy, what can be freed. */
export const GROUP_GRID = gridSpec<GroupColumn>({
  key: "sizeatlas.duplicates.groups.columns",
  pinned: "name",
  labelKey,
  columns: [
    // With the others, about the default width of the group list: all four fit.
    { id: "name", width: 150, numeric: false },
    { id: "copies", width: 64, numeric: true },
    { id: "size", width: 88, numeric: true },
    { id: "free", width: 110, numeric: true },
  ],
});

/** The copies of a group: where each lies, when it changed, its root and what holds it back. */
export const COPY_GRID = gridSpec<CopyColumn>({
  key: "sizeatlas.duplicates.copies.columns",
  pinned: "path",
  labelKey,
  columns: [
    { id: "path", width: 480, numeric: false },
    { id: "modified", width: 140, numeric: false },
    { id: "root", width: 110, numeric: false },
    { id: "marks", width: 200, numeric: false },
  ],
});

export interface DupSort<K extends string> {
  column: K;
  descending: boolean;
}

export const GROUP_SORT_KEY = "sizeatlas.duplicates.groups.sort";
export const COPY_SORT_KEY = "sizeatlas.duplicates.copies.sort";
export const GROUP_SORTS: readonly GroupColumn[] = ["name", "copies", "size", "free"];
/** What holds a copy back is no order. */
export const COPY_SORTS: readonly CopyColumn[] = ["path", "modified", "root"];
export const DEFAULT_GROUP_SORT: DupSort<GroupColumn> = { column: "free", descending: true };
export const DEFAULT_COPY_SORT: DupSort<CopyColumn> = { column: "path", descending: false };

export const serializeDupSort = (sort: DupSort<string>) =>
  `${sort.column}:${sort.descending ? "desc" : "asc"}`;

/** A stored sort by one of `columns`; anything else gives `fallback`. */
export function parseDupSort<K extends string>(
  raw: string | null,
  columns: readonly K[],
  fallback: DupSort<K>,
): DupSort<K> {
  const [column, direction] = (raw ?? "").split(":");
  return columns.includes(column as K) && (direction === "asc" || direction === "desc")
    ? { column: column as K, descending: direction === "desc" }
    : fallback;
}

/** Columns of text start from A, numbers and dates from the largest. */
const TEXT: readonly string[] = ["name", "path", "root"];

/** A header click: the same column flips; another starts with the largest (text: from A). */
export const nextDupSort = <K extends string>(current: DupSort<K>, column: K): DupSort<K> =>
  column === current.column
    ? { column, descending: !current.descending }
    : { column, descending: !TEXT.includes(column) };

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byKey = (a: DupGroup, b: DupGroup) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const GROUP_ORDER: Readonly<Record<GroupColumn, (a: DupGroup, b: DupGroup) => number>> = {
  name: (a, b) => byName.compare(a.name, b.name),
  copies: (a, b) => a.copies.length - b.copies.length,
  size: (a, b) => a.size - b.size,
  free: (a, b) => a.free - b.free,
};

/**
 * The groups in `sort` order; equal ones by what can be freed, the larger first, then by key, so
 * the order holds between answers.
 */
export function sortGroups(groups: Iterable<DupGroup>, sort: DupSort<GroupColumn>): DupGroup[] {
  const sign = sort.descending ? -1 : 1;
  const compare = GROUP_ORDER[sort.column];
  return [...groups].sort((a, b) => sign * compare(a, b) || b.free - a.free || byKey(a, b));
}

const COPY_ORDER: Readonly<
  Record<Exclude<CopyColumn, "marks">, (a: DupCopy, b: DupCopy) => number>
> = {
  path: (a, b) => byName.compare(a.path, b.path),
  modified: (a, b) => a.mtime - b.mtime,
  root: (a, b) => byName.compare(a.root, b.root),
};

/** The indices of `copies` in `sort` order; equal ones by path. */
export function copyOrder(copies: readonly DupCopy[], sort: DupSort<CopyColumn>): number[] {
  const sign = sort.descending ? -1 : 1;
  const compare = sort.column === "marks" ? () => 0 : COPY_ORDER[sort.column];
  return copies
    .map((_, i) => i)
    .sort(
      (a, b) =>
        sign * compare(copies[a], copies[b]) || COPY_ORDER.path(copies[a], copies[b]) || a - b,
    );
}

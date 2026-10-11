import type { SortKey } from "../../api/types";

export type ColumnId =
  | "name"
  | "path"
  | "len"
  | "size"
  | "percent"
  | "files"
  | "folders"
  | "dirs"
  | "created"
  | "modified"
  | "accessed"
  | "attributes"
  | "owner";

export interface Column {
  id: ColumnId;
  /** Sort key, or null if the column cannot be sorted. */
  sortKey: SortKey | null;
  /** Default width in pixels. */
  width: number;
  numeric: boolean;
  /** Read from disk on demand (see useDetails), not part of the listing. */
  detail?: true;
  /** Shown in the flat lists only (see features/lists). */
  listOnly?: true;
}

/** In display order. "len" is the logical size, "size" the size on disk; percent sorts like it. "path", the folder of a list item, exists in the flat lists only. */
export const COLUMNS: readonly Column[] = [
  { id: "name", sortKey: "name", width: 280, numeric: false },
  { id: "path", sortKey: null, width: 240, numeric: false, listOnly: true },
  { id: "len", sortKey: "len", width: 96, numeric: true },
  { id: "size", sortKey: "size", width: 96, numeric: true },
  { id: "percent", sortKey: "size", width: 120, numeric: true },
  { id: "files", sortKey: "files", width: 80, numeric: true },
  { id: "folders", sortKey: null, width: 72, numeric: true },
  { id: "dirs", sortKey: "dirs", width: 88, numeric: true },
  { id: "created", sortKey: null, width: 140, numeric: false, detail: true },
  { id: "modified", sortKey: "modified", width: 140, numeric: false },
  { id: "accessed", sortKey: null, width: 140, numeric: false, detail: true },
  { id: "attributes", sortKey: null, width: 90, numeric: false, detail: true },
  { id: "owner", sortKey: null, width: 180, numeric: false, detail: true },
];

export type Widths = Readonly<Record<ColumnId, number>>;

export const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width])) as Widths;

export interface SortState {
  /** The header that shows the arrow ("percent" and "size" share a key). */
  column: ColumnId;
  key: SortKey;
  descending: boolean;
}

/** Largest on disk first. */
export const DEFAULT_SORT: SortState = { column: "size", key: "size", descending: true };

/** The header that shows the arrow, and which way it points. */
export type HeaderSort = Pick<SortState, "column" | "descending">;

/** A folder listing sorts by the columns that have a backend sort key. */
export const hasSortKey = (column: Column) => column.sortKey !== null;

/** A header click: the same column flips the direction; another starts descending (names ascending). */
export function nextSort(current: SortState, column: Column): SortState {
  if (column.sortKey === null) return current;
  if (column.id === current.column) return { ...current, descending: !current.descending };
  return { column: column.id, key: column.sortKey, descending: column.sortKey !== "name" };
}

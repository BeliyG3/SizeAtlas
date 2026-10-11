import type { ListItem } from "../../api/types";
import type { ColumnId } from "../contents/columns";

/** The backend returns at most this many items of a list. */
export const LIST_LIMIT = 1000;

/** A header sort of a flat list. */
export interface ListSort {
  readonly column: ColumnId;
  readonly descending: boolean;
}

const text = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const NUMBERS: Partial<Record<ColumnId, (item: ListItem) => number>> = {
  len: (i) => i.len,
  size: (i) => i.size,
  percent: (i) => i.size,
  files: (i) => i.files,
  folders: (i) => i.folders,
  dirs: (i) => i.dirs,
  modified: (i) => i.modified,
};

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
  return [...items].sort((a, b) => sign * compare(a, b, sort.column));
}

/** A header click: the same column flips; another starts descending, names and paths ascending. */
export function nextListSort(current: ListSort | null, column: ColumnId): ListSort {
  if (current?.column === column) return { column, descending: !current.descending };
  return { column, descending: column !== "name" && column !== "path" };
}

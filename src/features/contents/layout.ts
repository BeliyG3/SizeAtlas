import {
  COLUMNS,
  DEFAULT_SORT,
  type Column,
  type ColumnId,
  type SortState,
  type Widths,
} from "./columns";
import { repairOrder } from "../columns/order";

/** Which columns the table shows, and in what order. Name is always first and visible. */
export interface ColumnView {
  /** Every column, hidden ones included, so a column shown again returns to its place. */
  order: readonly ColumnId[];
  hidden: readonly ColumnId[];
}

export const VIEW_KEY = "sizeatlas.columns.view";

export const DEFAULT_VIEW: ColumnView = { order: COLUMNS.map((c) => c.id), hidden: [] };

/** A stored view; an unusable field gives its default, unknown or missing columns are repaired. */
export function parseView(raw: string | null): ColumnView {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    // Garbage in storage: use the default.
  }
  if (stored === null || typeof stored !== "object") return DEFAULT_VIEW;
  const { order, hidden } = stored as Record<string, unknown>;
  const hiddenIds: unknown[] = Array.isArray(hidden) ? hidden : [];
  return {
    // Columns of a newer version than the stored order go to the end; Name goes first.
    order: ["name", ...repairOrder(order, DEFAULT_VIEW.order).filter((id) => id !== "name")],
    hidden: DEFAULT_VIEW.order.filter((id) => id !== "name" && hiddenIds.includes(id)),
  };
}

export const serializeView = (view: ColumnView) => JSON.stringify(view);

/** Shows a hidden column or hides a shown one; Name cannot be hidden. */
export function toggleColumn(view: ColumnView, id: ColumnId): ColumnView {
  if (id === "name") return view;
  const hidden = view.hidden.includes(id)
    ? view.hidden.filter((c) => c !== id)
    : [...view.hidden, id];
  return { ...view, hidden };
}

const BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

/** Whether the column exists in the flat lists only (Path). */
export const isListOnly = (id: ColumnId) => BY_ID.get(id)?.listOnly === true;

/** The columns shown, in display order; `lists`: a flat list, which also has the Path column. */
export const visibleColumns = (view: ColumnView, lists: boolean): Column[] =>
  view.order
    .filter((id) => !view.hidden.includes(id) && (lists || !isListOnly(id)))
    .map((id) => BY_ID.get(id)!);

/** CSS grid columns shared by the header and every row. */
export const gridTemplate = (columns: readonly Column[], widths: Widths) =>
  columns.map((c) => `${widths[c.id]}px`).join(" ");

export const totalWidth = (columns: readonly Column[], widths: Widths) =>
  columns.reduce((sum, c) => sum + widths[c.id], 0);

const NAME_SORT: SortState = { column: "name", key: "name", descending: false };

/** The sort in effect: a hidden column cannot sort, so the default (or Name) takes over. */
export function visibleSort(sort: SortState, view: ColumnView): SortState {
  if (!view.hidden.includes(sort.column)) return sort;
  return view.hidden.includes(DEFAULT_SORT.column) ? NAME_SORT : DEFAULT_SORT;
}

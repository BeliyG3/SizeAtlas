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
  /** Shown by the user: such a column hidden by default (see `withDefaults`) is shown too. */
  shown: readonly ColumnId[];
}

export const VIEW_KEY = "sizeatlas.columns.view";

export const DEFAULT_VIEW: ColumnView = { order: COLUMNS.map((c) => c.id), hidden: [], shown: [] };

/** The view in effect: Change is hidden by default while the root has no `baseline`. */
export function withDefaults(view: ColumnView, baseline: boolean): ColumnView {
  if (baseline || view.hidden.includes("change") || view.shown.includes("change")) return view;
  return { ...view, hidden: [...view.hidden, "change"] };
}

/** A stored view; an unusable field gives its default, unknown or missing columns are repaired. */
export function parseView(raw: string | null): ColumnView {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    // Garbage in storage: use the default.
  }
  if (stored === null || typeof stored !== "object") return DEFAULT_VIEW;
  const { order, hidden, shown } = stored as Record<string, unknown>;
  const hiddenIds: unknown[] = Array.isArray(hidden) ? hidden : [];
  const shownIds: unknown[] = Array.isArray(shown) ? shown : [];
  return {
    // Columns of a newer version than the stored order go to the end; Name goes first.
    order: ["name", ...repairOrder(order, DEFAULT_VIEW.order).filter((id) => id !== "name")],
    hidden: DEFAULT_VIEW.order.filter((id) => id !== "name" && hiddenIds.includes(id)),
    shown: DEFAULT_VIEW.order.filter((id) => id !== "name" && shownIds.includes(id)),
  };
}

export const serializeView = (view: ColumnView) => JSON.stringify(view);

/**
 * Shows a column hidden in the view in effect (`withDefaults` with `baseline`), or hides a shown
 * one; Name cannot be hidden. The choice is kept in `view`, the stored one.
 */
export function toggleColumn(view: ColumnView, id: ColumnId, baseline: boolean): ColumnView {
  if (id === "name") return view;
  const others = (ids: readonly ColumnId[]) => ids.filter((c) => c !== id);
  return withDefaults(view, baseline).hidden.includes(id)
    ? { ...view, hidden: others(view.hidden), shown: [...others(view.shown), id] }
    : { ...view, hidden: [...others(view.hidden), id], shown: others(view.shown) };
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

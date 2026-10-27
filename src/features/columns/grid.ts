import { repairOrder } from "./order";

/** One column of a table built on a CSS grid (see `GridHeader`). */
export interface GridColumn<K extends string> {
  id: K;
  /** Default width in pixels. */
  width: number;
  numeric: boolean;
}

/**
 * The columns of one such table: where their layout is stored, the column that stays first and
 * shown (it identifies a row), and the text key of each label. Made by `gridSpec`, at module level.
 */
export interface GridSpec<K extends string> {
  key: string;
  columns: readonly GridColumn<K>[];
  pinned: K;
  labelKey: (id: K) => string;
  /** The default width of each column. */
  defaults: Readonly<Record<K, number>>;
}

export const gridSpec = <K extends string>(spec: Omit<GridSpec<K>, "defaults">): GridSpec<K> => ({
  ...spec,
  defaults: Object.fromEntries(spec.columns.map((c) => [c.id, c.width])) as Record<K, number>,
});

/** What `GridHeader` and its menu work with: the columns shown, their widths and the handlers. */
export interface GridLayout<K extends string, C extends GridColumn<K> = GridColumn<K>> {
  columns: readonly C[];
  ids: readonly K[];
  widths: Readonly<Record<K, number>>;
  template: string;
  width: number;
  pinned: K;
  labelKey: (id: K) => string;
  /** The checkboxes of the header menu, in order: every column this table can show. */
  options: readonly { id: K; shown: boolean }[];
  resize: (id: K, width: number, done: boolean) => void;
  fit: (id: K) => void;
  fitAll: () => void;
  move: (id: K, before: K | null) => void;
  toggle: (id: K) => void;
  reset: () => void;
}

/** CSS grid columns shared by the header and every row. */
export const gridTemplate = <K extends string>(
  columns: readonly { id: K }[],
  widths: Readonly<Record<K, number>>,
) => columns.map((c) => `${widths[c.id]}px`).join(" ");

export const totalWidth = <K extends string>(
  columns: readonly { id: K }[],
  widths: Readonly<Record<K, number>>,
) => columns.reduce((sum, c) => sum + widths[c.id], 0);

/** Order and hidden columns of a table; the pinned column is first and never hidden. */
export interface GridView<K extends string> {
  order: readonly K[];
  hidden: readonly K[];
}

export const defaultView = <K extends string>(spec: GridSpec<K>): GridView<K> => ({
  order: spec.columns.map((c) => c.id),
  hidden: [],
});

/** A stored view; unknown or missing columns are repaired, the pinned one goes first. */
export function parseGridView<K extends string>(
  spec: GridSpec<K>,
  raw: string | null,
): GridView<K> {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    // Garbage in storage: use the default.
  }
  const fallback = defaultView(spec);
  if (stored === null || typeof stored !== "object") return fallback;
  const { order, hidden } = stored as Record<string, unknown>;
  const hiddenIds: unknown[] = Array.isArray(hidden) ? hidden : [];
  return {
    order: [spec.pinned, ...repairOrder(order, fallback.order).filter((id) => id !== spec.pinned)],
    hidden: fallback.order.filter((id) => id !== spec.pinned && hiddenIds.includes(id)),
  };
}

/** Hides a shown column or shows a hidden one; the pinned column stays. */
export function toggleGridColumn<K extends string>(
  spec: GridSpec<K>,
  view: GridView<K>,
  id: K,
): GridView<K> {
  if (id === spec.pinned) return view;
  const hidden = view.hidden.includes(id)
    ? view.hidden.filter((c) => c !== id)
    : [...view.hidden, id];
  return { ...view, hidden };
}

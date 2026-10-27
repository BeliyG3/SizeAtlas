import { useMemo, type RefObject } from "react";
import type { ListKind } from "../../api/types";
import { useStored } from "../../settings/storage";
import { fitWidth, measureColumn } from "../columns/fit";
import { gridTemplate, totalWidth, type GridLayout } from "../columns/grid";
import { useHeaderWidths } from "../columns/headerFit";
import { moveColumn } from "../columns/order";
import { useColumnWidths } from "../columns/useColumnWidths";
import { DEFAULT_WIDTHS, type Column, type ColumnId } from "./columns";
import {
  DEFAULT_VIEW,
  VIEW_KEY,
  isListOnly,
  parseView,
  serializeView,
  toggleColumn,
  visibleColumns,
  withDefaults,
  type ColumnView,
} from "./layout";

/** The widths the user set, one per column id. */
const WIDTHS_KEY = "sizeatlas.columns.widths";
/**
 * The same, from before the defaults fitted the header labels: Fit and Reset stored every column,
 * so its widths at a default are left behind once (see `legacyWidths`).
 */
const LEGACY_WIDTHS_KEY = "sizeatlas.columns";

const labelKey = (id: ColumnId) => `col.${id}`;

/** The layout of the folder table and the flat lists: their view and whether a list is shown too. */
export interface ColumnLayout extends GridLayout<ColumnId, Column> {
  view: ColumnView;
  lists: boolean;
}

/**
 * Widths, order and visibility of the table's columns, all stored. `body` holds the cells;
 * `list`: the flat list shown (null for a folder), which also has the list columns (Path,
 * Before); `baseline`: the root has a previous scan to compare with. `withDefaults` says which
 * columns stay hidden until the user shows them.
 */
export function useColumnLayout(
  body: RefObject<HTMLElement | null>,
  list: ListKind | null,
  baseline: boolean,
): ColumnLayout {
  const lists = list !== null;
  const { widths, stored, resize, store } = useColumnWidths(
    WIDTHS_KEY,
    DEFAULT_WIDTHS,
    useHeaderWidths(body, DEFAULT_WIDTHS, labelKey),
    LEGACY_WIDTHS_KEY,
  );
  const [storedView, setView] = useStored(VIEW_KEY, parseView, serializeView);
  const view = useMemo(
    () => withDefaults(storedView, baseline, list),
    [storedView, baseline, list],
  );
  const columns = useMemo(() => visibleColumns(view, lists), [view, lists]);
  // One array per view: the memoized rows render these cells.
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);

  /** Event handlers only: sizes columns to their rendered header and rows. */
  const fit = (fitted: readonly ColumnId[]) => {
    // Only these become widths the user set: the others keep following their header labels.
    const next: Partial<Record<ColumnId, number>> = { ...stored };
    for (const id of fitted) next[id] = fitWidth(measureColumn(body.current, id));
    store(next);
  };

  return {
    view,
    lists,
    columns,
    ids,
    widths,
    template: gridTemplate(columns, widths),
    width: totalWidth(columns, widths),
    pinned: "name",
    labelKey,
    options: view.order
      .filter((id) => lists || !isListOnly(id))
      .map((id) => ({ id, shown: !view.hidden.includes(id) })),
    resize,
    fit: (id) => fit([id]),
    fitAll: () => fit(ids),
    toggle: (id) => setView(toggleColumn(storedView, id, baseline, list)),
    move: (id, before) =>
      setView({ ...storedView, order: moveColumn(storedView.order, id, before, "name") }),
    reset: () => {
      // No width the user set: the defaults, fitted to the header labels, take over.
      store({});
      setView(DEFAULT_VIEW);
    },
  };
}

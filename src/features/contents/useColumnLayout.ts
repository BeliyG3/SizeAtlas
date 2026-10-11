import { useMemo, type RefObject } from "react";
import { useStored } from "../../settings/storage";
import { fitWidth, measureColumn } from "../columns/fit";
import { moveColumn } from "../columns/order";
import { useColumnWidths } from "../columns/useColumnWidths";
import { DEFAULT_WIDTHS, type ColumnId } from "./columns";
import {
  DEFAULT_VIEW,
  VIEW_KEY,
  gridTemplate,
  parseView,
  serializeView,
  toggleColumn,
  totalWidth,
  visibleColumns,
} from "./layout";

/** The key and shape of the widths stored before columns could be moved or hidden. */
const WIDTHS_KEY = "sizeatlas.columns";

/** Widths, order and visibility of the table's columns, all stored. `body` holds the cells; `lists`: a flat list, which also shows the Path column. */
export function useColumnLayout(body: RefObject<HTMLElement | null>, lists: boolean) {
  const { widths, resize, store } = useColumnWidths(WIDTHS_KEY, DEFAULT_WIDTHS);
  const [view, setView] = useStored(VIEW_KEY, parseView, serializeView);
  const columns = useMemo(() => visibleColumns(view, lists), [view, lists]);
  // One array per view: the memoized rows render these cells.
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);

  /** Event handlers only: sizes columns to their rendered header and rows. */
  const fit = (fitted: readonly ColumnId[]) => {
    const next: Record<ColumnId, number> = { ...widths };
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
    resize,
    fit: (id: ColumnId) => fit([id]),
    fitAll: () => fit(ids),
    toggle: (id: ColumnId) => setView(toggleColumn(view, id)),
    move: (id: ColumnId, before: ColumnId | null) =>
      setView({ ...view, order: moveColumn(view.order, id, before, "name") }),
    reset: () => {
      store(DEFAULT_WIDTHS);
      setView(DEFAULT_VIEW);
    },
  };
}

export type ColumnLayout = ReturnType<typeof useColumnLayout>;

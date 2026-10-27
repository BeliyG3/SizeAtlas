import { useMemo, type RefObject } from "react";
import { useStored } from "../../settings/storage";
import { fitWidth, measureColumn } from "./fit";
import {
  defaultView,
  gridTemplate,
  parseGridView,
  toggleGridColumn,
  totalWidth,
  type GridLayout,
  type GridSpec,
  type GridView,
} from "./grid";
import { useHeaderWidths } from "./headerFit";
import { moveColumn } from "./order";
import { useColumnWidths } from "./useColumnWidths";

const serialize = (view: GridView<string>) => JSON.stringify(view);

/**
 * Widths, order and visibility of the columns of a table of `spec` (a module-level constant), all
 * stored under keys of `spec.key`; `body` holds the cells. Every column is shown until the user
 * hides it; the pinned one stays first and shown.
 */
export function useGridColumns<K extends string>(
  body: RefObject<HTMLElement | null>,
  spec: GridSpec<K>,
): GridLayout<K> {
  const { defaults } = spec;
  const { widths, stored, resize, store } = useColumnWidths<K>(
    `${spec.key}.widths`,
    defaults,
    useHeaderWidths(body, defaults, spec.labelKey),
  );
  const [view, setView] = useStored<GridView<K>>(
    `${spec.key}.view`,
    (raw) => parseGridView(spec, raw),
    serialize,
  );
  const columns = useMemo(() => {
    const byId = new Map(spec.columns.map((c) => [c.id, c]));
    return view.order.filter((id) => !view.hidden.includes(id)).map((id) => byId.get(id)!);
  }, [spec, view]);
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);

  /** Event handlers only: sizes columns to their rendered header and rows. */
  const fit = (fitted: readonly K[]) => {
    const next: Partial<Record<K, number>> = { ...stored };
    for (const id of fitted) next[id] = fitWidth(measureColumn(body.current, id));
    store(next);
  };

  return {
    columns,
    ids,
    widths,
    template: gridTemplate(columns, widths),
    width: totalWidth(columns, widths),
    pinned: spec.pinned,
    labelKey: spec.labelKey,
    options: view.order.map((id) => ({ id, shown: !view.hidden.includes(id) })),
    resize,
    fit: (id) => fit([id]),
    fitAll: () => fit(ids),
    move: (id, before) =>
      setView({ ...view, order: moveColumn(view.order, id, before, spec.pinned) }),
    toggle: (id) => setView(toggleGridColumn(spec, view, id)),
    reset: () => {
      store({});
      setView(defaultView(spec));
    },
  };
}

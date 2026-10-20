import { useT } from "../../i18n/react";
import { ColumnDivider } from "../columns/ColumnDivider";
import { DragGhost } from "../columns/DragGhost";
import { useColumnDrag } from "../columns/useColumnDrag";
import { nextTreeSort, type TreeSort, type TreeSortKey } from "./sort";

interface Props {
  /** The two columns in the order shown. */
  columns: readonly TreeSortKey[];
  onMove: (id: TreeSortKey, before: TreeSortKey | null) => void;
  sort: TreeSort;
  /** Tooltip of the size column: how sizes on disk were measured. */
  sizeHint: string;
  onSort: (sort: TreeSort) => void;
  /** Width of the size column, which its border towards the name resizes. */
  sizeWidth: number;
  onResize: (width: number, done: boolean) => void;
  onFit: () => void;
}

/**
 * Sticky header of the folder tree: a click on a cell sorts (a second click reverses), dragging
 * a cell swaps the columns, the border between them resizes the size column.
 */
export function TreeHeader({ columns, onMove, sort, sizeHint, onSort, ...size }: Props) {
  const { t } = useT();
  const drag = useColumnDrag(columns, onMove);
  // The border sits between the columns: on the size column's left, or its right once it is first.
  const side = columns[0] === "size" ? "right" : "left";
  return (
    <div className="tree-head dim" role="row">
      {columns.map((key) => {
        const active = sort.key === key;
        const label = t(`tree.${key}`);
        return (
          <span
            key={key}
            role="columnheader"
            aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
            data-col={key}
            className={drag.dragging === key ? "col-dragging" : undefined}
            title={key === "size" ? sizeHint : label}
            onPointerDown={(e) => drag.start(key, e)}
            onClickCapture={drag.suppressClick}
          >
            <button className="col-sort" onClick={() => onSort(nextTreeSort(sort, key))}>
              <span className="ellipsis">{label}</span>
              {active && <span aria-hidden="true">{sort.descending ? "▼" : "▲"}</span>}
            </button>
            {key === "size" && (
              <ColumnDivider
                label={t("columns.width", { name: label })}
                width={size.sizeWidth}
                side={side}
                onResize={size.onResize}
                onFit={size.onFit}
              />
            )}
          </span>
        );
      })}
      <DragGhost view={drag.view} />
    </div>
  );
}

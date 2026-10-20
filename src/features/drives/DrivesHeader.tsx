import { useT } from "../../i18n/react";
import { ColumnDivider } from "../columns/ColumnDivider";
import { DragGhost } from "../columns/DragGhost";
import { useColumnDrag } from "../columns/useColumnDrag";
import { nextDriveSort, type DriveColumn, type DriveSort } from "./sort";

export type NumberColumn = Exclude<DriveColumn, "name">;

interface Props {
  /** The columns in the order shown. */
  order: readonly DriveColumn[];
  onMove: (id: DriveColumn, before: DriveColumn | null) => void;
  sort: DriveSort;
  onSort: (sort: DriveSort) => void;
  widths: Readonly<Record<NumberColumn, number>>;
  onResize: (id: NumberColumn, width: number, done: boolean) => void;
  onFit: (id: NumberColumn) => void;
}

/**
 * Header of the drives list: a click on a cell sorts (again: reverses), dragging a cell moves
 * its column, the border of a number column towards the name resizes it.
 */
export function DrivesHeader({ order, onMove, sort, onSort, widths, onResize, onFit }: Props) {
  const { t } = useT();
  const drag = useColumnDrag(order, onMove);
  const nameAt = order.indexOf("name");
  return (
    <thead>
      <tr>
        {order.map((id, i) => {
          const active = sort.key === id;
          const label = t(`drives.${id}`);
          const classes = [id !== "name" && "num", drag.dragging === id && "col-dragging"];
          return (
            <th
              key={id}
              data-col={id}
              aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
              className={classes.filter(Boolean).join(" ") || undefined}
              // A label cut short by a narrow column shows in full on hover.
              title={label}
              onPointerDown={(e) => drag.start(id, e)}
              onClickCapture={drag.suppressClick}
            >
              <button className="col-sort" onClick={() => onSort(nextDriveSort(sort, id))}>
                <span className="ellipsis">{label}</span>
                {active && <span aria-hidden="true">{sort.descending ? "▼" : "▲"}</span>}
              </button>
              {id !== "name" && (
                <ColumnDivider
                  label={t("columns.width", { name: label })}
                  width={widths[id]}
                  // The name takes the rest of the width: the border faces it.
                  side={i < nameAt ? "right" : "left"}
                  onResize={(width, done) => onResize(id, width, done)}
                  onFit={() => onFit(id)}
                />
              )}
            </th>
          );
        })}
      </tr>
      <DragGhost view={drag.view} />
    </thead>
  );
}

import { memo, type CSSProperties } from "react";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ItemIcon } from "../contents/ItemIcon";
import { Icon } from "../icons/Icon";
import { canExpand, type Row } from "./model";
import { ScanMark } from "./RootMarks";

interface Props {
  row: Row;
  /** `rowKey(row)`: names the row to the callbacks and in the DOM. */
  rowId: string;
  focused: boolean;
  /** The size column comes before the name (the user moved it). */
  sizeFirst: boolean;
  /** Files the running scan has counted; set on the row of the root being scanned only. */
  scanFiles?: number;
  onActivate: (rowId: string) => void;
  /** Expands or collapses the folder of the row without choosing it. */
  onToggle: (rowId: string) => void;
  onMenu: (rowId: string, x: number, y: number) => void;
}

const INDENT = 18;

const percent = (size: number, parentSize: number) =>
  parentSize > 0 ? Math.min(100, (100 * size) / parentSize) : 0;

/** One row of the tree. Memoized: moving the focus repaints two rows, not all of them. */
export const TreeRow = memo(function TreeRow({
  row,
  rowId,
  focused,
  sizeFirst,
  scanFiles,
  onActivate,
  onToggle,
  onMenu,
}: Props) {
  const { t } = useT();
  const size = useSize();
  const shared = {
    id: `row-${rowId}`,
    "data-key": rowId,
    role: "treeitem",
    "aria-selected": focused,
    "aria-level": row.depth + 1,
    onClick: () => onActivate(rowId),
  };
  const focusClass = focused ? " focused" : "";
  if (row.kind === "more") {
    return (
      <div
        {...shared}
        className={`tree-row more${focusClass}`}
        style={{ paddingInlineStart: 8 + row.depth * INDENT + INDENT }}
      >
        {t("tree.more", { count: row.restCount, size: size(row.restSize) })}
      </div>
    );
  }
  const item = row.kind === "item" ? row.item : null;
  const root = row.kind === "root" ? row.info : null;
  const cell: { name: string; bytes: number | null; expandable: boolean } =
    row.kind === "item"
      ? {
          name: row.item.name,
          bytes: row.item.pending && !row.item.scanning ? null : row.item.size,
          expandable: canExpand(row.item),
        }
      : {
          name: row.info.label,
          bytes: row.info.generation === null ? null : row.info.size,
          expandable: row.expandable,
        };
  const nameCell = (
    <span
      key="name"
      className="name"
      style={{ "--indent": `${row.depth * INDENT}px` } as CSSProperties}
    >
      <span
        className="expander"
        onClick={(e) => {
          e.stopPropagation();
          if (cell.expandable) onToggle(rowId);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {cell.expandable &&
          (row.expanded ? (
            <Icon name="chevron-down" />
          ) : (
            <Icon name="chevron-right" className="icon-dir" />
          ))}
      </span>
      {root?.drive ? <Icon name="drive" className="drive-icon" /> : <ItemIcon isDir category={0} />}
      <span className="label" title={root?.root}>
        {cell.name}
      </span>
      {root && root.status !== "open" && <ScanMark status={root.status} files={scanFiles} />}
      {item?.scanning && <ScanMark status="scanning" files={item.files} />}
      {item?.pending && !item.scanning && <span className="tag">{t("tree.pending")}</span>}
      {item?.accessError && <span className="tag">{t("tree.noAccess")}</span>}
      {item?.cloud && <span className="tag">{t("tree.cloud")}</span>}
    </span>
  );
  const sizeCell = (
    <span
      key="size"
      className={`size${item?.pending || root?.scanning ? " dim" : ""}`}
      data-col="size"
    >
      {row.kind === "item" && (
        <span className="bar" style={{ width: `${percent(row.item.size, row.parentSize)}%` }} />
      )}
      {cell.bytes !== null && size(cell.bytes)}
    </span>
  );
  return (
    <div
      {...shared}
      aria-expanded={cell.expandable ? row.expanded : undefined}
      className={`tree-row${focusClass}`}
      onDoubleClick={() => cell.expandable && onToggle(rowId)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(rowId, e.clientX, e.clientY);
      }}
    >
      {sizeFirst ? [sizeCell, nameCell] : [nameCell, sizeCell]}
    </div>
  );
});

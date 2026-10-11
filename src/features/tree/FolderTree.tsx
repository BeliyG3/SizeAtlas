import { useMemo, useRef, type CSSProperties } from "react";
import { useStored } from "../../settings/storage";
import { fitWidth, measureColumn } from "../columns/fit";
import { useColumnOrder } from "../columns/useColumnOrder";
import { useColumnWidths } from "../columns/useColumnWidths";
import {
  TREE_SORT_KEY,
  parseTreeSort,
  serializeTreeSort,
  treeOrder,
  type TreeSortKey,
} from "./sort";
import { TreeBody, type TreeProps } from "./TreeBody";
import { TreeHeader } from "./TreeHeader";
import "./tree.css";

/** The size column; the name takes the rest of the width. */
const DEFAULT_WIDTHS = { size: 84 };
/** The user can swap the columns by dragging a header. */
const DEFAULT_ORDER: readonly TreeSortKey[] = ["name", "size"];

/** The tree with its sort header; a new sort remounts the body, which then reveals the target again. */
export function FolderTree({ sizeHint, ...props }: TreeProps) {
  const [sort, setSort] = useStored(TREE_SORT_KEY, parseTreeSort, serializeTreeSort);
  const order = useMemo(() => treeOrder(sort), [sort]);
  const { widths, resize } = useColumnWidths("sizeatlas.tree.columns", DEFAULT_WIDTHS);
  const [columns, move] = useColumnOrder("sizeatlas.tree.columns.order", DEFAULT_ORDER);
  const sizeFirst = columns[0] === "size";
  const box = useRef<HTMLDivElement>(null);
  // A CSS variable: resizing repaints the memoized rows without rendering them again.
  const style = { "--tree-size": `${widths.size}px` } as CSSProperties;
  return (
    <div
      className={sizeFirst ? "tree size-first" : "tree"}
      ref={box}
      style={style}
      // No native menu on the rows that have none of ours, nor on the header.
      onContextMenu={(e) => e.preventDefault()}
    >
      <TreeHeader
        columns={columns}
        onMove={move}
        sort={sort}
        sizeHint={sizeHint}
        onSort={setSort}
        sizeWidth={widths.size}
        onResize={(width, done) => resize("size", width, done)}
        onFit={() => resize("size", fitWidth(measureColumn(box.current, "size")), true)}
      />
      <TreeBody key={serializeTreeSort(sort)} order={order} sizeFirst={sizeFirst} {...props} />
    </div>
  );
}

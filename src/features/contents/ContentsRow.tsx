import { memo, type MouseEvent, type ReactNode } from "react";
import type { Detail, Item, ListItem } from "../../api/types";
import { formatCount, formatDate, formatPercent } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import type { ColumnId } from "./columns";
import { ItemIcon } from "./ItemIcon";
import { markHow, type MarkHow } from "./marks";
import { ROW_HEIGHT } from "./pages";
import { ScanMark } from "../tree/RootMarks";

interface Props {
  index: number;
  /** Undefined while its page is loading, and for the unaccounted row. A list item also has its folder (Path). */
  item: Item | ListItem | undefined;
  /** Above 0 only for the "unaccounted" row at the end of a volume root. */
  unaccounted: number;
  /** Size on disk of the current folder: the base of the percentages. */
  folderSize: number;
  /** Undefined until read from disk. */
  detail: Detail | undefined;
  /** Columns shown, in order (one array per column layout: rows are memoized). */
  columns: readonly ColumnId[];
  template: string;
  width: number;
  selected: boolean;
  cursor: boolean;
  /** `how`: what Ctrl and Shift make of the click (see `markHow`). */
  onClick: (index: number, how: MarkHow) => void;
  onOpen: (index: number) => void;
  onMenu: (index: number, x: number, y: number) => void;
}

/** One table row; memoized, so scrolling repaints only the rows that come into view. */
export const ContentsRow = memo(function ContentsRow({
  index,
  item,
  unaccounted,
  folderSize,
  detail,
  columns,
  template,
  width,
  selected,
  cursor,
  onClick,
  onOpen,
  onMenu,
}: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const shared = {
    id: `crow-${index}`,
    "data-index": index,
    role: "row",
    "aria-rowindex": index + 2,
    "aria-selected": selected,
    style: { top: index * ROW_HEIGHT, width, gridTemplateColumns: template },
    onClick: (e: MouseEvent) => onClick(index, markHow(e)),
  };
  const state = `${index % 2 ? " alt" : ""}${selected ? " selected" : ""}${cursor ? " cursor" : ""}`;
  if (unaccounted > 0) {
    return (
      <div {...shared} className={`crow unaccounted${state}`} title={t("tree.unaccountedHint")}>
        {columns.map((id) => (
          <span
            key={id}
            role="gridcell"
            data-col={id}
            className={id === "size" ? "num" : undefined}
          >
            {id === "name" ? t("tree.unaccounted") : id === "size" ? size(unaccounted) : null}
          </span>
        ))}
      </div>
    );
  }
  if (!item) {
    return (
      <div {...shared} className={`crow loading${state}`}>
        <span role="gridcell" className="dim">
          …
        </span>
      </div>
    );
  }
  const share = folderSize > 0 ? item.size / folderSize : 0;
  const dir = item.isDir;
  const waiting = item.pending && !item.scanning;
  // Empty while the details are on their way; a dash when they could not be read.
  const text = (value: string | null | undefined) => (detail ? (value ?? "—") : "");
  const time = (value: number | null | undefined) =>
    detail ? formatDate(value ?? null, lang) : "";
  const count = (value: number) => (dir ? formatCount(value, lang) : "");
  const cells: Record<ColumnId, [className: string | undefined, content: ReactNode]> = {
    name: [
      "name",
      <>
        <ItemIcon isDir={dir} category={item.category} />
        <span className="ellipsis">{item.name}</span>
        {item.scanning && <ScanMark status="scanning" files={undefined} />}
        {waiting && <span className="tag">{t("tree.pending")}</span>}
        {item.accessError && <span className="tag">{t("tree.noAccess")}</span>}
        {item.cloud && <span className="tag">{t("tree.cloud")}</span>}
      </>,
    ],
    path: [undefined, "folder" in item ? item.folder : ""],
    len: ["num", item.pending ? "" : size(item.len)],
    size: [item.pending ? "num dim" : "num", waiting ? "" : size(item.size)],
    percent: [
      "percent",
      <>
        <span className="share-bar" style={{ width: `${Math.min(100, 100 * share)}%` }} />
        <span className="num">{waiting ? "" : formatPercent(share, lang)}</span>
      </>,
    ],
    files: ["num", waiting ? "" : count(item.files)],
    folders: ["num", item.pending ? "" : count(item.folders)],
    dirs: ["num", item.pending ? "" : count(item.dirs)],
    created: [undefined, time(detail?.created)],
    modified: [undefined, formatDate(item.modified, lang)],
    accessed: [undefined, time(detail?.accessed)],
    attributes: [undefined, text(detail?.attributes)],
    owner: [undefined, text(detail?.owner)],
  };
  return (
    <div
      {...shared}
      className={`crow${state}`}
      onDoubleClick={() => onOpen(index)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(index, e.clientX, e.clientY);
      }}
    >
      {columns.map((id) => (
        <span key={id} role="gridcell" data-col={id} className={cells[id][0]}>
          {cells[id][1]}
        </span>
      ))}
    </div>
  );
});

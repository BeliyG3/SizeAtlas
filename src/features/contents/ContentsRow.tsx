import { memo, type MouseEvent, type ReactNode } from "react";
import type { Detail, Item, ListItem } from "../../api/types";
import { changeParts, formatCount, formatDate, formatPercent } from "../../format";
import { useT } from "../../i18n/react";
import { useSettings, useSize } from "../../settings/react";
import type { ColumnId } from "./columns";
import { ItemIcon } from "./ItemIcon";
import { markHow, type MarkHow } from "./marks";
import { pathTitle } from "./pathTitle";
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
  /** Full path of the listed folder (lists): the Path cell shows the item's full path on hover. */
  folderPath?: string;
  selected: boolean;
  cursor: boolean;
  /** It is being moved to the trash: dimmed, with a tag. */
  moving?: boolean;
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
  folderPath = "",
  selected,
  cursor,
  moving = false,
  onClick,
  onOpen,
  onMenu,
}: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const { unit } = useSettings();
  const shared = {
    id: `crow-${index}`,
    "data-index": index,
    role: "row",
    "aria-rowindex": index + 2,
    "aria-selected": selected,
    style: { top: index * ROW_HEIGHT, width, gridTemplateColumns: template },
    onClick: (e: MouseEvent) => onClick(index, markHow(e)),
  };
  // A folder of the previous scan that is gone ("Grew most"): dimmed and tagged.
  const deleted = item !== undefined && "deleted" in item && item.deleted;
  const state = `${index % 2 ? " alt" : ""}${selected ? " selected" : ""}${cursor ? " cursor" : ""}${moving ? " moving" : ""}${deleted ? " deleted" : ""}`;
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
  // The change of a size that is still being counted is not known yet.
  const change = waiting ? null : item.change;
  const delta = typeof change === "object" ? (change?.delta ?? 0) : 0;
  const approx = delta !== 0 && item.approxChange;
  const parts = changeParts(delta, lang, unit);
  // The sign stays with the number in a right-to-left table; the unit goes as in Size.
  const changeText =
    change === "new"
      ? t("change.new")
      : change === "unknown"
        ? "?"
        : parts && (
            <>
              <bdi dir="ltr">{`${approx ? "≈ " : ""}${parts[0]}`}</bdi> {parts[1]}
            </>
          );
  const changeClass = delta > 0 ? "num change-up" : delta < 0 ? "num change-down" : "num";
  const changeHint =
    change === "unknown" ? t("change.coverage") : approx ? t("change.approx") : undefined;
  const cells: Record<
    ColumnId,
    [className: string | undefined, content: ReactNode, title?: string]
  > = {
    name: [
      "name",
      <>
        <ItemIcon isDir={dir} category={item.category} />
        <span className="ellipsis" dir="auto">
          {item.name}
        </span>
        {deleted && <span className="tag">{t("change.deleted")}</span>}
        {moving && <span className="tag">{t("trash.moving")}</span>}
        {item.scanning && <ScanMark status="scanning" files={undefined} />}
        {waiting && <span className="tag">{t("tree.pending")}</span>}
        {item.accessError && <span className="tag">{t("tree.noAccess")}</span>}
        {item.cloud && <span className="tag">{t("tree.cloud")}</span>}
      </>,
    ],
    path: [undefined, "folder" in item ? item.folder : "", pathTitle(folderPath, item, lang)],
    len: ["num", item.pending ? "" : size(item.len)],
    size: [item.pending ? "num dim" : "num", waiting ? "" : size(item.size)],
    percent: [
      "percent",
      <>
        <span className="share-bar" style={{ width: `${Math.min(100, 100 * share)}%` }} />
        <span className="num">{waiting ? "" : formatPercent(share, lang)}</span>
      </>,
    ],
    before: ["num", item.before === null ? "" : size(item.before)],
    change: [changeClass, changeText, changeHint],
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
        <span
          key={id}
          role="gridcell"
          data-col={id}
          dir={id === "path" ? "auto" : undefined}
          className={cells[id][0]}
          title={cells[id][2]}
        >
          {cells[id][1]}
        </span>
      ))}
    </div>
  );
});

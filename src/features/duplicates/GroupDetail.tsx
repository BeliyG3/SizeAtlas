import { Fragment, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../../api/client";
import type { DupCopy, DupGroup } from "../../api/duplicates";
import { formatDate } from "../../format";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useStored } from "../../settings/storage";
import { GridHeader } from "../columns/GridHeader";
import { useGridColumns } from "../columns/useGridColumns";
import { mark, markAll, markHow, targets, type MarkHow, type Marks } from "../contents/marks";
import { HEADER_HEIGHT, ROW_HEIGHT } from "../contents/pages";
import { tableKeyDown, type RowActions } from "../contents/tableView";
import { scrollToRow } from "../contents/useCursor";
import { SplitPane } from "../shell/SplitPane";
import {
  COPY_GRID,
  COPY_SORTS,
  COPY_SORT_KEY,
  DEFAULT_COPY_SORT,
  copyOrder,
  nextDupSort,
  parseDupSort,
  serializeDupSort,
  shownSort,
  type CopyColumn,
} from "./columns";
import { GroupTitle, PreviewPicture } from "./GroupPreview";
import { mimeOf } from "./thumbs";
import type { Picture } from "./viewer/useImageUrl";
import "../contents/contents.css";

/** Why a copy is never removed here, or what removing it means. */
const MARKS = ["protected", "noId", "hardlink", "synced"] as const;

/**
 * The marked copies and the copy under the cursor, by their index in the group (the marks keyed
 * by `copyMarksKey`); the table may show them in another order.
 */
export interface CopyPick {
  marks: Marks;
  cursor: number | null;
}

/** What an action on the copies takes: the marked ones, else the one under the cursor. */
export const pickTargets = (pick: CopyPick) => targets(pick.marks, pick.cursor ?? undefined);

const sortable = (c: { id: CopyColumn }) => COPY_SORTS.includes(c.id);
const parseSort = (raw: string | null) => parseDupSort(raw, COPY_SORTS, DEFAULT_COPY_SORT);

interface Props {
  group: DupGroup;
  pick: CopyPick;
  onPick: (pick: CopyPick) => void;
  /** Delete: the copies at these indices to the trash. Shift+Delete does nothing. */
  onTrash: (indices: number[]) => void;
  /** The menu of the copies at these indices, at viewport coordinates. */
  onMenu: (indices: number[], x: number, y: number) => void;
  /** The picture of the group (`useImageUrl`). */
  picture: Picture;
  /** The picture full screen, and in a window of its own. */
  onFull: () => void;
  onWindow: () => void;
  onFail: (e: unknown) => void;
}

/**
 * The copies of one group: where each one lies and what holds it back. Its rows are marked and
 * moved through like those of any table; a double click or Enter shows the copy in the file
 * manager.
 */
export function GroupDetail(props: Props) {
  const { group, pick, onPick, onTrash, onMenu, picture, onFull, onWindow, onFail } = props;
  const { t, lang } = useT();
  const count = group.copies.length;
  const body = useRef<HTMLDivElement>(null);
  const layout = useGridColumns(body, COPY_GRID);
  const [stored, setSort] = useStored(COPY_SORT_KEY, parseSort, serializeDupSort);
  // A column hidden while it sorts hands the order to the default one, as in the main table.
  const sort = shownSort(stored, layout.ids, DEFAULT_COPY_SORT, COPY_GRID.pinned);
  /** The copy shown in each row, by its index in the group. */
  const order = useMemo(() => copyOrder(group.copies, sort), [group, sort]);
  const { marks, cursor } = pick;
  const at = cursor === null ? -1 : order.indexOf(cursor);
  const row = at < 0 ? null : at;
  const idAt = (index: number) => order[index];
  const point = (index: number, how: MarkHow) =>
    onPick({ marks: mark(marks, how, index, idAt, row ?? index), cursor: order[index] });
  const reveal = (index: number) => {
    const ref = group.copies[order[index]]?.refs[0];
    if (ref) void api.reveal(ref.generation, ref.id).catch(onFail);
  };
  /** The keys and clicks, by row; `shown` scrolls a row into view. */
  const actions = (shown: (index: number) => void): RowActions => ({
    point: (index, how) => {
      shown(index);
      point(index, how);
    },
    markAll: () => onPick({ marks: markAll(marks, count, idAt), cursor }),
    trash: () => onTrash(pickTargets(pick)),
    open: reveal,
    menuAt: (index, x, y) => {
      // A row outside the marks is marked on its own, as in the other tables.
      if (marks.ids.has(order[index]) && marks.ids.size > 1) onMenu([...marks.ids], x, y);
      else {
        point(index, "one");
        onMenu([order[index]], x, y);
      }
    },
    up: () => {},
  });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const viewport = Math.max(0, el.clientHeight - HEADER_HEIGHT);
    const keys = actions((index) => scrollToRow(el, index));
    tableKeyDown(e, { cursor: row, viewport, count }, keys, isRtl(lang));
  };
  const mouse = actions(() => {});
  // Shift ranges count rows: another order starts them afresh, the marks stay.
  const onSort = (column: CopyColumn) => {
    setSort(nextDupSort(sort, column));
    onPick({ marks: { key: marks.key, ids: marks.ids, anchor: null }, cursor });
  };
  const cells = (copy: DupCopy): Record<CopyColumn, ReactNode> => {
    const held = MARKS.filter((m) => copy[m]).map((m) => t(`dup.${m}`));
    return {
      path: (
        <span role="gridcell" data-col="path" dir="auto" title={copy.path}>
          {copy.path}
        </span>
      ),
      modified: (
        <span role="gridcell" data-col="modified">
          {formatDate(copy.mtime || null, lang)}
        </span>
      ),
      root: (
        <span role="gridcell" data-col="root" dir="auto" title={copy.root}>
          {copy.root}
        </span>
      ),
      marks: (
        <span role="gridcell" data-col="marks" className="tag" title={held.join("\n")}>
          {held.join(" · ")}
        </span>
      ),
    };
  };
  // ponytail: every copy is rendered; virtualize if groups of thousands of copies show up.
  const table = (
    <div
      className="contents dup-table"
      ref={body}
      role="grid"
      aria-label={t("dup.colCopies")}
      aria-multiselectable
      aria-rowcount={count + 1}
      aria-colcount={layout.columns.length}
      aria-activedescendant={row === null ? undefined : `dcopy-${row}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <GridHeader layout={layout} sort={sort} canSort={sortable} onSort={(c) => onSort(c.id)} />
      <div className="crows" style={{ height: count * ROW_HEIGHT, width: layout.width }}>
        {order.map((copyAt, index) => {
          const copy = group.copies[copyAt];
          const marked = marks.ids.has(copyAt);
          const state = `${index % 2 ? " alt" : ""}${marked ? " selected" : ""}${index === row ? " cursor" : ""}`;
          const shown = cells(copy);
          return (
            <div
              key={copy.path}
              id={`dcopy-${index}`}
              data-index={index}
              role="row"
              aria-rowindex={index + 2}
              aria-selected={marked}
              className={`crow${state}`}
              style={{
                top: index * ROW_HEIGHT,
                width: layout.width,
                gridTemplateColumns: layout.template,
              }}
              onClick={(e) => mouse.point(index, markHow(e))}
              onDoubleClick={() => reveal(index)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                mouse.menuAt(index, e.clientX, e.clientY);
              }}
            >
              {layout.ids.map((id) => (
                <Fragment key={id}>{shown[id]}</Fragment>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="dup-detail">
      <GroupTitle
        group={group}
        target={group.copies[cursor ?? order[0]]}
        onFull={onFull}
        onWindow={onWindow}
        onFail={onFail}
      />
      {/* The same split for every group, so the table in it is never recreated. */}
      <SplitPane
        direction="column"
        sized="first"
        storageKey="sizeatlas.split.dupPreview"
        defaultSize={170}
        label={t("split.preview")}
        collapse={mimeOf(group.name) ? undefined : "first"}
        first={<PreviewPicture group={group} picture={picture} onFull={onFull} />}
        second={table}
      />
    </div>
  );
}

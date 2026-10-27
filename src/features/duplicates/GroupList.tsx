import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { DupGroup } from "../../api/duplicates";
import { formatCount } from "../../format";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ROW_HEIGHT, visibleRange } from "../contents/pages";
import { tableKeyDown, useViewport, type RowActions } from "../contents/tableView";
import { scrollToRow } from "../contents/useCursor";
import { GridHeader } from "../columns/GridHeader";
import { useGridColumns } from "../columns/useGridColumns";
import {
  DEFAULT_GROUP_SORT,
  GROUP_GRID,
  nextDupSort,
  shownSort,
  type DupSort,
  type GroupColumn,
} from "./columns";
import { Thumb } from "./Thumb";
import type { ThumbQueue } from "./thumbs";
import "../contents/contents.css";

interface Props {
  /** In the order shown. */
  groups: readonly DupGroup[];
  /** Key of the group whose copies are shown. */
  selected: string | null;
  onPick: (key: string) => void;
  sort: DupSort<GroupColumn>;
  onSort: (sort: DupSort<GroupColumn>) => void;
  /** Thumbnails: only those of the rows on screen and of the selected group are asked for. */
  queue: ThumbQueue;
}

const nothing = () => {};
const sortable = () => true;

/** The groups of the result, one row each; the selected one is the cursor row. Virtual. */
export function GroupList({ groups, selected, onPick, sort, onSort, queue }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const body = useRef<HTMLDivElement>(null);
  const layout = useGridColumns(body, GROUP_GRID);
  // A column hidden while it sorts hands the order to the default one, as in the main table.
  const shown = shownSort(sort, layout.ids, DEFAULT_GROUP_SORT, GROUP_GRID.pinned);
  useEffect(() => {
    if (shown !== sort) onSort(shown);
  }, [shown, sort, onSort]);
  const { scrollTop, viewport, onScroll } = useViewport(body);
  const { first, last } = visibleRange(scrollTop, viewport, groups.length);
  const at = groups.findIndex((g) => g.key === selected);
  const cursor = at < 0 ? null : at;
  // A group picked elsewhere (the arrows of the full-screen view) is scrolled into view; not a
  // row that only moved because the result grew, which would pull the list from under the user.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (selected === scrolledTo.current) return;
    scrolledTo.current = selected;
    if (cursor !== null && body.current) scrollToRow(body.current, cursor);
  }, [selected, cursor]);
  // After the rows asked for theirs (child effects run first): drop what scrolled away.
  useEffect(() => {
    const keys = new Set(groups.slice(first, last).map((g) => g.key));
    if (selected !== null) keys.add(selected);
    queue.keep(keys);
  }, [queue, groups, first, last, selected]);

  const point = (index: number) => {
    if (groups.length === 0) return;
    const next = Math.max(0, Math.min(groups.length - 1, index));
    if (body.current) scrollToRow(body.current, next);
    onPick(groups[next].key);
  };
  // A group is not an item: no marks, no menu, nothing to open or go up to.
  const actions: RowActions = {
    point,
    markAll: nothing,
    trash: nothing,
    open: nothing,
    menuAt: nothing,
    up: nothing,
  };

  const cells = (group: DupGroup): Record<GroupColumn, ReactNode> => ({
    name: (
      <span role="gridcell" data-col="name" className="name" title={group.name}>
        <Thumb group={group} queue={queue} />
        <span className="ellipsis" dir="auto">
          {group.name}
        </span>
      </span>
    ),
    copies: (
      <span role="gridcell" data-col="copies" className="num">
        ×{formatCount(group.copies.length, lang)}
      </span>
    ),
    size: (
      <span role="gridcell" data-col="size" className="num">
        {size(group.size)}
      </span>
    ),
    free: (
      <span role="gridcell" data-col="free" className="num">
        {t("dup.free", { size: size(group.free) })}
      </span>
    ),
  });
  const rows: ReactNode[] = [];
  for (let index = first; index < last; index++) {
    const group = groups[index];
    const state = `${index % 2 ? " alt" : ""}${index === cursor ? " cursor" : ""}`;
    const row = cells(group);
    rows.push(
      <div
        key={group.key}
        id={`dgroup-${index}`}
        data-index={index}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={index === cursor}
        className={`crow${state}`}
        style={{
          top: index * ROW_HEIGHT,
          width: layout.width,
          gridTemplateColumns: layout.template,
        }}
        onClick={() => point(index)}
      >
        {layout.ids.map((id) => (
          <Fragment key={id}>{row[id]}</Fragment>
        ))}
      </div>,
    );
  }
  const cursorShown = cursor !== null && cursor >= first && cursor < last;

  return (
    <div
      className="contents dup-table"
      ref={body}
      role="grid"
      aria-label={t("mode.duplicates")}
      aria-rowcount={groups.length + 1}
      aria-colcount={layout.columns.length}
      aria-activedescendant={cursorShown ? `dgroup-${cursor}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) =>
        tableKeyDown(e, { cursor, viewport, count: groups.length }, actions, isRtl(lang))
      }
      onContextMenu={(e) => e.preventDefault()}
    >
      <GridHeader
        layout={layout}
        sort={sort}
        canSort={sortable}
        onSort={(c) => onSort(nextDupSort(sort, c.id))}
      />
      <div className="crows" style={{ height: groups.length * ROW_HEIGHT, width: layout.width }}>
        {rows}
      </div>
    </div>
  );
}

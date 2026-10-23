import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Detail, ListItem, ListKind, Summary } from "../../api/types";
import { formatCount, formatSize } from "../../format";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { CleanupNotes } from "../cleanup/CleanupNotes";
import type { Column } from "../contents/columns";
import { ContentsRow } from "../contents/ContentsRow";
import { mark, markAll, marksKey, targets, type MarkHow } from "../contents/marks";
import { ROW_HEIGHT, visibleRange } from "../contents/pages";
import { TableHeader } from "../contents/TableHeader";
import {
  tableKeyDown,
  useDetailsOnPause,
  useRowCallbacks,
  useViewport,
} from "../contents/tableView";
import { comparedByDefault } from "../contents/layout";
import { useColumnLayout } from "../contents/useColumnLayout";
import { scrollToRow } from "../contents/useCursor";
import { useMarks } from "../contents/useMarks";
import { useExportSource, type ExportSource } from "../export/source";
import type { MenuTarget } from "../menu/ItemMenu";
import { useMovingIds } from "../trash/moving";
import { itemPath } from "../export/names";
import {
  LIST_LIMIT,
  defaultListSort,
  emptyListKey,
  liveId,
  menuCleanup,
  nextListSort,
  sortRows,
  type ListSort,
} from "./rows";
import { isCleanupMode } from "./modes";
import { useListAnswer } from "./useListAnswer";
import "../contents/contents.css";

/**
 * Details are read from disk for the rows on screen only, so their columns cannot sort a list;
 * Why is a text of a fixed set with no order of its own.
 */
const canSort = (column: Column) => !column.detail && column.id !== "reason";

interface Props {
  summary: Summary;
  kind: ListKind;
  /** The words of a "search" list. */
  query?: string;
  /** The folder whose subtree is listed. */
  base: number;
  /** Full path of `base`; empty while unknown. */
  basePath: string;
  /** Parent of `base`; null at the scan root or while unknown. */
  parent: number | null;
  selectedId: number;
  details: ReadonlyMap<number, Detail>;
  onNeedDetails: (ids: readonly number[]) => void;
  /** A row was clicked or reached with the keys: its item gets selected. */
  onPick: (item: ListItem) => void;
  /** The list is made for folder `id` (in `parent`): double click or Enter on it, Backspace for the parent. */
  onEnter: (id: number, parent?: number) => void;
  /** Instead of `onEnter` for Enter or a double click on a folder (not for Backspace): a search leaves itself there. */
  onOpenFolder?: (id: number, parent?: number) => void;
  onMenu: (target: MenuTarget) => void;
  /** Delete: asks to move `ids` to the trash. */
  onTrash: (ids: readonly number[]) => void;
  /** The marked items, whenever they change: Scan › Move to the trash acts on them. */
  onMarks: (ids: readonly number[]) => void;
  onFail: (e: unknown) => void;
}

/**
 * A flat list of the subtree of a folder: the first 1000 items in the order of `kind`, which a
 * header click sorts among themselves. Mounted once per list and folder.
 */
export function ListTable({
  summary,
  kind,
  query,
  base,
  basePath,
  parent,
  selectedId,
  details,
  onNeedDetails,
  onPick,
  onEnter,
  onOpenFolder = onEnter,
  onMenu,
  onTrash,
  onMarks,
  onFail,
}: Props) {
  const { t, lang } = useT();
  const { generation, rev, baselineRev } = summary;
  const moving = useMovingIds(generation);
  const body = useRef<HTMLDivElement>(null);
  const layout = useColumnLayout(body, kind, comparedByDefault(summary));
  const { list, shownQuery } = useListAnswer({
    generation,
    rev,
    baselineRev,
    base,
    kind,
    query,
    liveScan: summary.scanning ?? false,
    onFail,
  });
  // Null: the order of the list itself.
  const [chosenSort, setSort] = useState<ListSort | null>(() => defaultListSort(kind));
  // Hiding the sorted column brings back the list's own order.
  const sort = chosenSort && layout.view.hidden.includes(chosenSort.column) ? null : chosenSort;
  // The cursor and the marks belong to this order, revision and query of the list.
  const listKey = `${summary.scanning ? "live" : `${rev}.${baselineRev}`}:${sort?.column ?? "list"}:${sort?.descending ?? false}:${shownQuery}`;
  const [cursorAt, setCursorAt] = useState<{ key: string; index: number } | null>(null);
  const cursor = cursorAt?.key === listKey ? cursorAt.index : null;
  const setCursor = (index: number) => setCursorAt({ key: listKey, index });
  const { scrollTop, viewport, onScroll } = useViewport(body);
  const rows = useMemo(() => (list ? sortRows(list.items, sort) : []), [list, sort]);
  const exportSource = useMemo<ExportSource | null>(
    () =>
      list && {
        kind: "list",
        generation,
        base,
        list: kind,
        query: shownQuery || undefined,
        rows,
        rev: list.rev,
        size: list.size,
        columns: layout.ids,
      },
    [list, generation, base, kind, shownQuery, rows, layout.ids],
  );
  useExportSource(exportSource);
  const [marks, setMarks] = useMarks(listKey, selectedId);
  // A deleted folder is not a node: it cannot be marked, so no action takes it to the backend.
  const idAt = (index: number) => liveId(rows[index]);
  useEffect(() => onMarks([...marks.ids]), [marks.ids, onMarks]);
  useEffect(() => () => onMarks([]), [onMarks]);
  const { first, last } = visibleRange(scrollTop, viewport, rows.length);

  // Results of another query open at the top, not where the last ones were scrolled to.
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [shownQuery]);

  const visibleIds = useMemo(
    () => rows.slice(first, last).flatMap((r) => liveId(r) ?? []),
    [rows, first, last],
  );
  useDetailsOnPause(
    layout.columns.some((c) => c.detail),
    visibleIds,
    onNeedDetails,
    scrollTop,
  );

  /**
   * Click or arrow keys: the row gets the cursor and the marks; a plain one also the selection
   * (the marks go under the key of that selection).
   */
  const point = (index: number, how: MarkHow) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setCursor(next);
    if (body.current) scrollToRow(body.current, next);
    const key = how === "one" ? marksKey(listKey, rows[next].id) : marks.key;
    setMarks({ ...mark(marks, how, next, idAt, cursor ?? next), key });
    if (how === "one" && !rows[next].deleted) onPick(rows[next]);
  };
  const open = (index: number) => {
    const item = rows[index];
    if (item?.deleted) return;
    if (item?.isDir) onOpenFolder(item.id, item.parent);
    else if (item) void api.openItem(generation, item.id).catch(onFail);
  };
  const menuAt = (index: number, x: number, y: number) => {
    const item = rows[index];
    // A deleted folder offers only Copy path: of its full path, once the list's own is known.
    if (!item || (item.deleted && !basePath)) return;
    setCursor(index);
    // A right click on a row that is not marked marks it alone, as in a file manager.
    const shown = marks.ids.has(item.id) ? marks : mark(marks, "one", index, idAt);
    setMarks(shown);
    const deletedPath = item.deleted ? itemPath(basePath, item) : undefined;
    const { isDir, lossy } = item;
    const cleanup = menuCleanup(item, kind);
    onMenu({ id: item.id, isDir, lossy, marked: [...shown.ids], deletedPath, ...cleanup, x, y });
  };
  // Up: the list of the parent of the listed folder (nothing at the root).
  const up = () => {
    if (parent !== null) onEnter(parent);
  };
  const actions = {
    point,
    trash: () => {
      const ids = targets(marks, cursor === null ? undefined : idAt(cursor));
      if (ids.length > 0) onTrash(ids);
    },
    markAll: () => setMarks(markAll(marks, rows.length, idAt)),
    open,
    menuAt,
    up,
  };
  const callbacks = useRowCallbacks(actions);

  const shown: ReactNode[] = [];
  for (let index = first; index < last; index++) {
    const item = rows[index];
    shown.push(
      <ContentsRow
        key={index}
        index={index}
        item={item}
        unaccounted={0}
        folderSize={list?.size ?? 0}
        detail={details.get(item.id)}
        columns={layout.ids}
        template={layout.template}
        width={layout.width}
        folderPath={basePath}
        selected={marks.ids.size > 0 ? marks.ids.has(item.id) : item.id === selectedId}
        cursor={index === cursor}
        moving={moving.has(item.id)}
        onClick={callbacks.onClick}
        onOpen={callbacks.onOpen}
        onMenu={callbacks.onMenu}
      />,
    );
  }
  const cursorShown = cursor !== null && cursor >= first && cursor < last;

  // The count and size of all matches, not only of the rows shown; nothing found says so below.
  const found = kind === "search" && list?.found && list.found.count > 0 ? list.found : null;

  return (
    <>
      {found && (
        // Announced when the answer comes, not again at every refresh of a live scan.
        <p className="dim pad found" role={summary.scanning ? undefined : "status"}>
          {t("search.found", {
            count: found.count,
            items: formatCount(found.count, lang),
            size: formatSize(found.size, lang),
          })}
        </p>
      )}
      {list && isCleanupMode(kind) && (
        <CleanupNotes list={list} summary={summary} onFail={onFail} />
      )}
      <div
        className="contents"
        ref={body}
        role="grid"
        aria-label={t(`mode.${kind}`)}
        aria-rowcount={rows.length + 1}
        aria-colcount={layout.columns.length}
        aria-activedescendant={cursorShown ? `crow-${cursor}` : undefined}
        tabIndex={0}
        data-search-results={kind === "search" ? "" : undefined}
        onScroll={onScroll}
        onKeyDown={(e) =>
          tableKeyDown(e, { cursor, viewport, count: rows.length }, actions, isRtl(lang))
        }
        // Entering with Tab: put the cursor on the first row so the keys have something to act on.
        onFocus={(e) => {
          if (e.target === e.currentTarget && cursor === null && rows.length > 0) setCursor(0);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <TableHeader
          layout={layout}
          sort={sort}
          canSort={canSort}
          sizeHint={t(`sizeMode.${summary.sizeMode}`)}
          baselineAt={summary.baselineAt}
          onSort={(column) => setSort(nextListSort(sort, column.id))}
        />
        <div className="crows" style={{ height: rows.length * ROW_HEIGHT, width: layout.width }}>
          {shown}
        </div>
        {list && rows.length === 0 && <p className="dim pad">{t(emptyListKey(kind, list))}</p>}
        {list?.truncated && (
          <p className="dim pad">{t("lists.capped", { count: formatCount(LIST_LIMIT, lang) })}</p>
        )}
      </div>
    </>
  );
}

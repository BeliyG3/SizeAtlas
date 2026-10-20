import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Detail, ListOrder, Summary } from "../../api/types";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useExportSource, type ExportSource } from "../export/source";
import type { MenuTarget } from "../menu/ItemMenu";
import { useMovingIds } from "../trash/moving";
import { hasSortKey, nextSort, type SortState } from "./columns";
import { ContentsRow } from "./ContentsRow";
import { visibleSort } from "./layout";
import { mark, markAll, marksKey, targets, type MarkHow } from "./marks";
import { ROW_HEIGHT, pagesFor, visibleRange } from "./pages";
import { TableHeader } from "./TableHeader";
import {
  SCROLL_PAUSE_MS,
  tableKeyDown,
  useDetailsOnPause,
  useRowCallbacks,
  useViewport,
} from "./tableView";
import { useColumnLayout } from "./useColumnLayout";
import { scrollToRow, useCursor } from "./useCursor";
import { useMarks } from "./useMarks";
import { itemAt, useRowPages } from "./useRowPages";
import { useRowPosition } from "./useRowPosition";
import "./contents.css";

interface Props {
  summary: Summary;
  /** Current folder. */
  folder: number;
  /** Parent of the current folder; null at the scan root or while unknown. */
  parent: number | null;
  selectedId: number;
  sort: SortState;
  /** List folders only (the "Folders only" filter). */
  dirsOnly: boolean;
  onSort: (sort: SortState) => void;
  details: ReadonlyMap<number, Detail>;
  onNeedDetails: (ids: readonly number[]) => void;
  onSelect: (id: number, isDir: boolean, parent?: number) => void;
  onMenu: (target: MenuTarget) => void;
  /** Delete: asks to move `ids` to the trash. */
  onTrash: (ids: readonly number[]) => void;
  /** The marked items, whenever they change: Scan › Move to the trash acts on them. */
  onMarks: (ids: readonly number[]) => void;
  onFail: (e: unknown) => void;
}

/** Contents of the current folder: a virtual grid with sortable, resizable columns. */
export function ContentsTable({
  summary,
  folder,
  parent,
  selectedId,
  sort: chosenSort,
  onSort,
  dirsOnly,
  details,
  onNeedDetails,
  onSelect,
  onMenu,
  onTrash,
  onMarks,
  onFail,
}: Props) {
  const { t, lang } = useT();
  const { generation, rev, rootId } = summary;
  const moving = useMovingIds(generation);
  const body = useRef<HTMLDivElement>(null);
  const layout = useColumnLayout(body, false);
  // Hiding the sorted column hands the order to a shown one.
  const sort = visibleSort(chosenSort, layout.view);
  const order = useMemo<ListOrder>(
    () => ({ key: sort.key, descending: sort.descending, dirsOnly }),
    [sort, dirsOnly],
  );
  const exportSource = useMemo<ExportSource>(
    () => ({ kind: "folder", generation, folder, order, columns: layout.ids }),
    [generation, folder, order, layout.ids],
  );
  useExportSource(exportSource);
  const { scrollTop, viewport, onScroll } = useViewport(body);
  const { listing, previous, request } = useRowPages(
    generation,
    rev,
    folder,
    order,
    onFail,
    summary.scanning,
  );
  // Live ticks keep the cursor and range anchor attached to their item ids.
  const listKey = `${folder}:${summary.scanning ? "live" : rev}:${sort.key}:${sort.descending}:${dirsOnly}`;

  const unaccounted = folder === rootId ? (summary.volume?.unaccounted ?? 0) : 0;
  const extra = unaccounted > 0 ? 1 : 0;
  const total = listing?.total ?? 0;
  const count = listing ? total + extra : 0;
  // Rows on screen: those of the previous order until the first page of the new one arrives.
  const shown = listing ?? previous;
  const shownTotal = shown?.total ?? 0;
  const shownCount = shown ? shownTotal + extra : 0;
  const { first, last } = visibleRange(scrollTop, viewport, shownCount);
  const { cursor, setCursor, pickedFile } = useCursor({
    generation,
    folder,
    selectedId,
    order,
    listKey,
    count,
    listing,
    live: summary.scanning === true,
    body,
    onFail,
  });
  // Marks of this listing and selection: anything else starts without any.
  const [storedMarks, setMarks] = useMarks(listKey, selectedId);
  const anchor = useRowPosition({
    generation,
    listKey,
    order,
    listing,
    live: summary.scanning === true,
    index: storedMarks.anchor,
    id: storedMarks.anchorId,
    onFail,
  });
  const marks = { ...storedMarks, anchor };
  const idAt = (index: number) => itemAt(listing, index)?.id;
  useEffect(() => onMarks([...marks.ids]), [marks.ids, onMarks]);
  useEffect(() => () => onMarks([]), [onMarks]);

  // Before the first answer the size of the listing is unknown: ask for its first page, or,
  // while the rows of another order or revision are on screen, for the pages they cover.
  const pagesKey = listing
    ? pagesFor(first, Math.min(last, total)).join(",")
    : previous
      ? pagesFor(first, Math.max(1, Math.min(last, previous.total))).join(",")
      : "0";
  // Fetched once scrolling pauses (every scroll restarts the timer), so dragging the scrollbar
  // over a huge folder does not request every page it passes.
  useEffect(() => {
    const pages = pagesKey === "" ? [] : pagesKey.split(",").map(Number);
    const timer = setTimeout(() => request(pages), SCROLL_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [pagesKey, request, scrollTop]);

  const visibleIds = useMemo(() => {
    const ids: number[] = [];
    for (let i = first; i < Math.min(last, total); i++) {
      const item = itemAt(listing, i);
      if (item) ids.push(item.id);
    }
    return ids;
  }, [listing, first, last, total]);
  useDetailsOnPause(
    layout.columns.some((c) => c.detail),
    visibleIds,
    onNeedDetails,
    scrollTop,
  );

  // A new folder or filter starts at the top (the onScroll handler then updates the state).
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [folder, dirsOnly]);

  /**
   * Click or arrow keys: the row gets the cursor and the marks; a plain click or arrow makes a
   * file the selection (the marks go under the key of that selection), a folder only gets the
   * cursor.
   */
  const point = (index: number, how: MarkHow) => {
    if (count === 0) return;
    if (how === "range" && storedMarks.anchorId !== undefined && anchor === null) return;
    const next = Math.max(0, Math.min(count - 1, index));
    setCursor(next);
    if (body.current) scrollToRow(body.current, next);
    const item = itemAt(listing, next);
    const selects = how === "one" && item !== undefined && !item.isDir;
    const key = selects ? marksKey(listKey, item.id) : marks.key;
    setMarks({ ...mark(marks, how, next, idAt, cursor ?? next), key });
    if (selects) {
      pickedFile(item.id);
      onSelect(item.id, false, folder);
    }
  };
  const open = (index: number) => {
    const item = itemAt(listing, index);
    if (item?.isDir) onSelect(item.id, true);
    else if (item) void api.openItem(generation, item.id).catch(onFail);
  };
  const menuAt = (index: number, x: number, y: number) => {
    const item = itemAt(listing, index);
    if (!item) return;
    setCursor(index);
    // A right click on a row that is not marked marks it alone, as in a file manager.
    const shown = marks.ids.has(item.id) ? marks : mark(marks, "one", index, idAt);
    setMarks(shown);
    onMenu({ id: item.id, isDir: item.isDir, lossy: item.lossy, marked: [...shown.ids], x, y });
  };
  const up = () => {
    if (parent !== null) onSelect(parent, true);
  };
  const actions = {
    point,
    trash: () => {
      const ids = targets(marks, cursor === null ? undefined : idAt(cursor));
      if (ids.length > 0) onTrash(ids);
    },
    markAll: () => setMarks(markAll(marks, count, idAt)),
    open,
    menuAt,
    up,
  };
  const callbacks = useRowCallbacks(actions);

  const { template, width } = layout;
  const folderSize = shown?.size ?? 0;
  const rows: ReactNode[] = [];
  for (let index = first; index < last; index++) {
    const item = index < shownTotal ? itemAt(shown, index) : undefined;
    rows.push(
      <ContentsRow
        key={index}
        index={index}
        item={item}
        unaccounted={index >= shownTotal ? unaccounted : 0}
        folderSize={folderSize}
        detail={item && details.get(item.id)}
        columns={layout.ids}
        template={template}
        width={width}
        selected={
          item !== undefined &&
          (marks.ids.size > 0 ? marks.ids.has(item.id) : item.id === selectedId)
        }
        cursor={index === cursor}
        moving={item !== undefined && moving.has(item.id)}
        onClick={callbacks.onClick}
        onOpen={callbacks.onOpen}
        onMenu={callbacks.onMenu}
      />,
    );
  }
  const cursorShown = cursor !== null && cursor >= first && cursor < last;

  return (
    <div
      className="contents"
      ref={body}
      role="grid"
      aria-label={t("contents.label")}
      aria-rowcount={shownCount + 1}
      aria-colcount={layout.columns.length}
      aria-activedescendant={cursorShown ? `crow-${cursor}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) => tableKeyDown(e, { cursor, viewport, count }, actions, isRtl(lang))}
      // Entering with Tab: put the cursor on the first row so the keys have something to act on.
      onFocus={(e) => {
        if (e.target === e.currentTarget && cursor === null && count > 0) setCursor(0);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TableHeader
        layout={layout}
        sort={sort}
        canSort={hasSortKey}
        sizeHint={t(`sizeMode.${summary.sizeMode}`)}
        onSort={(column) => onSort(nextSort(sort, column))}
      />
      <div
        className={
          !listing &&
          previous?.orderKey !== `${folder}:${order.key}:${order.descending}:${order.dirsOnly}`
            ? "crows stale"
            : "crows"
        }
        style={{ height: shownCount * ROW_HEIGHT, width }}
      >
        {rows}
      </div>
      {listing && count === 0 && (
        <p className="dim pad">{t(dirsOnly ? "contents.noFolders" : "contents.empty")}</p>
      )}
    </div>
  );
}

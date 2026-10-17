import { useBatchCost } from "../scan/useBatchCost";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Detail, List, ListItem, ListKind, Summary } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
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
import { useColumnLayout } from "../contents/useColumnLayout";
import { scrollToRow } from "../contents/useCursor";
import { useMarks } from "../contents/useMarks";
import { useExportSource, type ExportSource } from "../export/source";
import type { MenuTarget } from "../menu/ItemMenu";
import { useMovingIds } from "../trash/moving";
import { LIST_LIMIT, nextListSort, sortRows, type ListSort } from "./rows";
import "../contents/contents.css";

/** Details are read from disk for the rows on screen only, so their columns cannot sort a list. */
const canSort = (column: Column) => !column.detail;

interface Props {
  summary: Summary;
  kind: ListKind;
  /** The folder whose subtree is listed. */
  base: number;
  /** Parent of `base`; null at the scan root or while unknown. */
  parent: number | null;
  selectedId: number;
  details: ReadonlyMap<number, Detail>;
  onNeedDetails: (ids: readonly number[]) => void;
  /** A row was clicked or reached with the keys: its item gets selected. */
  onPick: (item: ListItem) => void;
  /** The list is made for folder `id` (in `parent`): double click or Enter on it, Backspace for the parent. */
  onEnter: (id: number, parent?: number) => void;
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
  base,
  parent,
  selectedId,
  details,
  onNeedDetails,
  onPick,
  onEnter,
  onMenu,
  onTrash,
  onMarks,
  onFail,
}: Props) {
  const { t, lang } = useT();
  const { generation, rev } = summary;
  const moving = useMovingIds(generation);
  const body = useRef<HTMLDivElement>(null);
  const layout = useColumnLayout(body, true);
  const [list, setList] = useState<List | null>(null);
  const measure = useBatchCost("tree", list);
  // Null: the order of the list itself.
  const [chosenSort, setSort] = useState<ListSort | null>(null);
  // Hiding the sorted column brings back the list's own order.
  const sort = chosenSort && layout.view.hidden.includes(chosenSort.column) ? null : chosenSort;
  // The cursor and the marks belong to this order and revision of the list.
  const listKey = `${summary.scanning ? "live" : rev}:${sort?.column ?? "list"}:${sort?.descending ?? false}`;
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
        rows,
        rev: list.rev,
        size: list.size,
        columns: layout.ids,
      },
    [list, generation, base, kind, rows, layout.ids],
  );
  useExportSource(exportSource);
  const [marks, setMarks] = useMarks(listKey, selectedId);
  const idAt = (index: number) => rows[index]?.id;
  useEffect(() => onMarks([...marks.ids]), [marks.ids, onMarks]);
  useEffect(() => () => onMarks([]), [onMarks]);
  const { first, last } = visibleRange(scrollTop, viewport, rows.length);

  // A change of the tree (`rev`) lists again; the old rows stay, dimmed, until the answer.
  useEffect(() => {
    let live = true;
    const applied = measure();
    api.getList(generation, base, kind, LIST_LIMIT).then(
      (answer) => {
        if (!live) return;
        applied();
        setList(answer);
      },
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, rev, base, kind, onFail, measure]);

  const visibleIds = useMemo(() => rows.slice(first, last).map((r) => r.id), [rows, first, last]);
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
    if (how === "one") onPick(rows[next]);
  };
  const open = (index: number) => {
    const item = rows[index];
    if (item?.isDir) onEnter(item.id, item.parent);
    else if (item) void api.openItem(generation, item.id).catch(onFail);
  };
  const menuAt = (index: number, x: number, y: number) => {
    const item = rows[index];
    if (!item) return;
    setCursor(index);
    // A right click on a row that is not marked marks it alone, as in a file manager.
    const shown = marks.ids.has(item.id) ? marks : mark(marks, "one", index, idAt);
    setMarks(shown);
    onMenu({ id: item.id, isDir: item.isDir, lossy: item.lossy, marked: [...shown.ids], x, y });
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

  return (
    <div
      className="contents"
      ref={body}
      role="grid"
      aria-label={t(`mode.${kind}`)}
      aria-rowcount={rows.length + 1}
      aria-colcount={layout.columns.length}
      aria-activedescendant={cursorShown ? `crow-${cursor}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) => tableKeyDown(e, { cursor, viewport, count: rows.length }, actions)}
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
        onSort={(column) => setSort(nextListSort(sort, column.id))}
      />
      <div className="crows" style={{ height: rows.length * ROW_HEIGHT, width: layout.width }}>
        {shown}
      </div>
      {list && rows.length === 0 && <p className="dim pad">{t("lists.empty")}</p>}
      {list?.truncated && (
        <p className="dim pad">{t("lists.capped", { count: formatCount(LIST_LIMIT, lang) })}</p>
      )}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { api } from "../../api/client";
import { ROOT_ID, type ListOrder } from "../../api/types";
import { isRtl, mirrorArrow } from "../../i18n";
import { useT } from "../../i18n/react";
import type { MenuTarget } from "../menu/ItemMenu";
import { isMenuKey } from "../menu/Menu";
import { anchorX } from "../menu/place";
import {
  PAGE_SIZE,
  buildRows,
  canExpand,
  keyTarget,
  nodeKey,
  pagesOf,
  pagesToReveal,
  rootKey,
  rowKey,
  shouldReveal,
  type RootInfo,
  type Row,
} from "./model";
import { TreeRow } from "./TreeRow";
import { useTreeData } from "./useTreeData";

/** The node to show. Every request is a new object, so choosing the same node again works. */
export interface TreeTarget {
  readonly root: string;
  /** Null for a root that has no tree yet. */
  readonly generation: number | null;
  readonly id: number;
}

export interface TreeProps {
  /** Rows of level 0, in their order. */
  roots: readonly RootInfo[];
  /** Folder to show: the tree loads the pages on its path, expands its parents and focuses it. */
  target: TreeTarget | null;
  /** Files the running scan has counted, shown on the row of its root. */
  scanned: { root: string; files: number } | null;
  /** Tooltip of the size column: how the selected root measured sizes on disk. */
  sizeHint: string;
  onSelectRoot: (root: string) => void;
  /** The user focused a folder row. */
  onSelectNode: (generation: number, id: number) => void;
  onItemMenu: (generation: number, target: MenuTarget) => void;
  onRootMenu: (root: string, x: number, y: number) => void;
  /** Delete on a folder row: asks to move it to the trash. */
  onTrash: (generation: number, ids: readonly number[]) => void;
  /** Stable handler for failed requests. */
  onFail: (e: unknown) => void;
}

type BodyProps = Omit<TreeProps, "sizeHint"> & { order: ListOrder; sizeFirst: boolean };

/** Whether the row has a folder (or a root) to expand or collapse. */
const canToggle = (row: Row | undefined): row is Exclude<Row, { kind: "more" }> =>
  row?.kind === "root" ? row.expandable : row?.kind === "item" && canExpand(row.item);

/** The rows of the tree for one sort order (FolderTree remounts it for another). */
export function TreeBody({
  roots,
  target,
  scanned,
  order,
  sizeFirst,
  onSelectRoot,
  onSelectNode,
  onItemMenu,
  onRootMenu,
  onTrash,
  onFail,
}: BodyProps) {
  const { t, lang } = useT();
  const rtl = isRtl(lang);
  const { loaded, expanded, collapsed, load, toggleRoot, toggleFolder, showPath } = useTreeData(
    roots,
    order,
    onFail,
  );
  const [focus, setFocus] = useState<string | null>(null);
  // The target the user moved away from with a focus that selects nothing (a show-more row):
  // that target no longer pins the focus to its root row.
  const [movedFrom, setMovedFrom] = useState<TreeTarget | null>(null);
  // Bumped by a reveal: scrolls to the focused row even when the focus stays the same.
  const [revealed, setRevealed] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const focusRef = useRef(focus);

  const rows = useMemo(
    () => buildRows(roots, loaded, expanded, collapsed),
    [roots, loaded, expanded, collapsed],
  );
  // Read by the reveal effect, which must not re-run when they change.
  const loadedRef = useRef(loaded);
  const rowsRef = useRef(rows);
  useEffect(() => {
    loadedRef.current = loaded;
    rowsRef.current = rows;
  }, [loaded, rows]);
  // A root is never revealed: when it is the target, its row is the focused one.
  const shownFocus =
    target !== null && target !== movedFrom && (target.generation === null || target.id === ROOT_ID)
      ? rootKey(target.root)
      : focus;
  const focusIndex = rows.findIndex((row) => rowKey(row) === shownFocus);

  const focusRow = (row: Row | undefined) => {
    if (!row) return;
    const key = rowKey(row);
    focusRef.current = key;
    setFocus(key);
    setMovedFrom(target);
    if (row.kind === "item") onSelectNode(row.generation, row.item.id);
    else if (row.kind === "root") onSelectRoot(row.info.root);
  };

  // The current folder chosen elsewhere (table, charts, breadcrumbs): load the pages on its path,
  // expand its root and its other ancestors, and focus it.
  useEffect(() => {
    if (target === null || target.generation === null || target.id === ROOT_ID) return;
    const { root, generation, id } = target;
    const key = nodeKey(generation, id);
    if (!shouldReveal(focusRef.current, rowsRef.current, key)) return;
    let live = true;
    api
      .getCrumbs(generation, id, order)
      .then(async (crumbs) => {
        const requests = pagesToReveal(pagesOf(loadedRef.current, generation), crumbs, PAGE_SIZE);
        const pages = await Promise.all(
          requests.map((r) => api.getChildren(generation, r.id, r.offset, r.limit, order)),
        );
        if (!live) return;
        showPath(root, generation, crumbs, requests, pages);
        focusRef.current = key;
        setFocus(key);
        setRevealed((n) => n + 1);
      })
      .catch((e: unknown) => {
        if (live) onFail(e);
      });
    return () => {
      live = false;
    };
  }, [target, order, onFail, showPath]);

  const toggle = (row: Exclude<Row, { kind: "more" }>) => {
    if (row.kind === "root") toggleRoot(row.info.root);
    else toggleFolder(row.generation, row.item.id);
  };

  const activate = (key: string) => {
    const row = rows.find((r) => rowKey(r) === key);
    if (!row) return;
    focusRow(row);
    if (row.kind === "more") {
      const have = pagesOf(loaded, row.generation).get(row.parentId)?.items.length ?? 0;
      // The show-more row moves down (or disappears): focus the first newly loaded item instead.
      void load(row.generation, row.parentId, have).then((page) => {
        const first = page?.items[0];
        if (first && focusRef.current === key) {
          const next = nodeKey(row.generation, first.id);
          focusRef.current = next;
          setFocus(next);
          onSelectNode(row.generation, first.id);
        }
      });
    }
  };

  const toggleRow = (key: string) => {
    const row = rows.find((r) => rowKey(r) === key);
    if (canToggle(row)) toggle(row);
  };

  const openMenu = (key: string, x: number, y: number) => {
    const row = rows.find((r) => rowKey(r) === key);
    if (row?.kind === "item") {
      focusRow(row);
      onItemMenu(row.generation, { id: row.item.id, isDir: true, lossy: row.item.lossy, x, y });
    } else if (row?.kind === "root") {
      focusRow(row);
      onRootMenu(row.info.root, x, y);
    }
  };

  // Rows are memoized, so their callbacks never change and call the latest handlers.
  const latest = useRef({ activate, toggleRow, openMenu });
  useLayoutEffect(() => {
    latest.current = { activate, toggleRow, openMenu };
  });
  const onRowActivate = useCallback((key: string) => latest.current.activate(key), []);
  const onRowToggle = useCallback((key: string) => latest.current.toggleRow(key), []);
  const onRowMenu = useCallback(
    (key: string, x: number, y: number) => latest.current.openMenu(key, x, y),
    [],
  );

  const onKey = (e: KeyboardEvent) => {
    const row = rows[focusIndex];
    if (isMenuKey(e)) {
      const box = list.current
        ?.querySelector(`[data-key="${shownFocus}"]`)
        ?.getBoundingClientRect();
      if (row && box) openMenu(rowKey(row), anchorX(box, rtl, 24), box.bottom);
      e.preventDefault();
      return;
    }
    // Alt+arrows go back and forward; modified keys are not the tree's.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = keyTarget(e.key, focusIndex, rows.length);
    if (to !== undefined) {
      focusRow(rows[to]);
      e.preventDefault();
      return;
    }
    // Right-to-left, the arrows swap: ← expands and → collapses.
    const key = mirrorArrow(e.key, rtl);
    switch (key) {
      case "ArrowRight":
      case "ArrowLeft":
        // Right expands a collapsed folder or root, Left collapses an expanded one.
        if (canToggle(row) && row.expanded === (key === "ArrowLeft")) toggle(row);
        break;
      case "Enter":
        if (row) activate(rowKey(row));
        break;
      case "Delete":
        // Never with Shift: only the clean-up lists delete for good, the tree never does.
        if (row?.kind === "item" && !e.shiftKey && !e.repeat) {
          onTrash(row.generation, [row.item.id]);
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  useEffect(() => {
    if (focus === null) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-key="${focus}"]`)
      ?.scrollIntoView({ block: "nearest" });
    // Only a focus change or a reveal scrolls: finished loads must not pull the view back.
  }, [focus, revealed]);

  return (
    <div
      className="tree-body"
      role="tree"
      aria-label={t("tree.label")}
      aria-activedescendant={focusIndex >= 0 ? `row-${shownFocus}` : undefined}
      tabIndex={0}
      onKeyDown={onKey}
      // Entering with Tab: highlight the current folder (or the first row) so the keys have
      // something to act on. Clicks are ignored, and the selection never changes here.
      onFocus={(e) => {
        if (focusIndex >= 0 || !e.currentTarget.matches(":focus-visible")) return;
        const current =
          target && target.generation !== null ? nodeKey(target.generation, target.id) : null;
        const key = rows.some((r) => rowKey(r) === current)
          ? current
          : rows[0]
            ? rowKey(rows[0])
            : null;
        focusRef.current = key;
        setFocus(key);
      }}
      ref={list}
    >
      {rows.map((row) => {
        const key = rowKey(row);
        const files =
          row.kind === "root" && scanned?.root === row.info.root ? scanned.files : undefined;
        return (
          <TreeRow
            key={key}
            rowId={key}
            row={row}
            focused={key === shownFocus}
            scanFiles={files}
            onActivate={onRowActivate}
            onToggle={onRowToggle}
            onMenu={onRowMenu}
            sizeFirst={sizeFirst}
          />
        );
      })}
    </div>
  );
}

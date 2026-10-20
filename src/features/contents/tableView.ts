import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from "react";
import { isMenuKey } from "../menu/Menu";
import { anchorX } from "../menu/place";
import type { MarkHow } from "./marks";
import { HEADER_HEIGHT, ROW_HEIGHT, rowTarget } from "./pages";

/** Rows scrolled past are neither fetched nor read from disk: requests wait for this pause. */
export const SCROLL_PAUSE_MS = 50;

/** What the rows of a table and its keys do. */
export interface RowActions {
  /** A click on row `index`, or a navigation key moved the cursor there; `how` marks it. */
  point: (index: number, how: MarkHow) => void;
  /** Ctrl+A. */
  markAll: () => void;
  /** Delete: the marked rows, else the cursor row, to the trash. */
  trash: () => void;
  /** Double click, or Enter on the cursor row. */
  open: (index: number) => void;
  /** The context menu of row `index` at viewport coordinates. */
  menuAt: (index: number, x: number, y: number) => void;
  /** Backspace or Alt+↑. */
  up: () => void;
}

/** Scroll position of a table and the height of the area under its header, which follows the box. */
export function useViewport(body: RefObject<HTMLDivElement | null>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setViewport(Math.max(0, el.clientHeight - HEADER_HEIGHT)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [body]);
  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop),
    [],
  );
  return { scrollTop, viewport, onScroll };
}

/**
 * Asks for the details of the rows on screen once scrolling pauses (every scroll restarts the
 * timer); nothing while no column shows details.
 */
export function useDetailsOnPause(
  wanted: boolean,
  ids: readonly number[],
  onNeed: (ids: readonly number[]) => void,
  scrollTop: number,
) {
  useEffect(() => {
    if (!wanted || ids.length === 0) return;
    const timer = setTimeout(() => onNeed(ids), SCROLL_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [wanted, ids, onNeed, scrollTop]);
}

/** Row callbacks that never change and call the latest actions: rows are memoized. */
export function useRowCallbacks(actions: RowActions) {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const onClick = useCallback((i: number, how: MarkHow) => latest.current.point(i, how), []);
  const onOpen = useCallback((i: number) => latest.current.open(i), []);
  const onMenu = useCallback(
    (i: number, x: number, y: number) => latest.current.menuAt(i, x, y),
    [],
  );
  return { onClick, onOpen, onMenu };
}

/**
 * Keys of a focused table: the menu key and Ctrl+A (also on a header button), Backspace and
 * Alt+↑, the navigation keys (with Shift: marking from the anchor) and Enter. Other keys, and
 * other keys pressed on the header buttons, are left alone. `rtl`: the page is right-to-left.
 */
export function tableKeyDown(
  e: KeyboardEvent<HTMLDivElement>,
  table: { cursor: number | null; viewport: number; count: number },
  actions: RowActions,
  rtl: boolean,
): void {
  const at = table.cursor ?? -1;
  if (isMenuKey(e)) {
    const box = e.currentTarget.querySelector(`[data-index="${at}"]`)?.getBoundingClientRect();
    if (box) actions.menuAt(at, anchorX(box, rtl, 24), box.bottom);
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyA") {
    actions.markAll();
    e.preventDefault();
    return;
  }
  // Keys pressed on the header buttons are theirs (Enter sorts).
  if (e.target !== e.currentTarget) return;
  if (e.key === "Delete") {
    // Never with Shift: there is no deleting for good. A held key does not repeat it.
    if (!e.repeat && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) actions.trash();
    e.preventDefault();
    return;
  }
  if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) {
    actions.up();
    e.preventDefault();
    return;
  }
  const pageRows = Math.max(1, Math.floor(table.viewport / ROW_HEIGHT) - 1);
  const to = rowTarget(e.key, at, pageRows, table.count);
  if (to !== null) actions.point(to, e.shiftKey ? "range" : "one");
  else if (e.key === "Enter") {
    // A held key does not repeat it: opening a file would start the program again and again.
    if (table.cursor !== null && !e.repeat) actions.open(table.cursor);
  } else return;
  e.preventDefault();
}

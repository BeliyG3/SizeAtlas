import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BACK_BUTTON, FORWARD_BUTTON, historyKey } from "../features/shell/historyKey";
import { busy, typing } from "../features/shell/keyGuards";
import {
  historyStep,
  idleSwipe,
  scrollsAlong,
  swipeDelta,
  swipeStep,
} from "../features/shell/swipe";
import { isRtl } from "../i18n";
import { useT } from "../i18n/react";
import { emptyHistory, restore, step, toVisit, visit } from "./history";
import type { RootEntry } from "./roots";
import type { Selection } from "./selection";

/**
 * Back and forward through the folders the view showed, from the mouse side buttons, Alt+← and
 * Alt+→, ⌘[ and ⌘], and a two-finger swipe on a trackpad; keys and swipe are mirrored in
 * right-to-left layouts. `record` adds a folder the user chose; `jump` shows one without recording it.
 */
export function useHistory(
  selection: Selection | null,
  entries: readonly RootEntry[],
  jump: (next: Selection) => void,
) {
  const [history, setHistory] = useState(emptyHistory);
  const rtl = isRtl(useT().lang);
  // Read by `record`, which must stay stable for the selection callbacks.
  const shown = useRef(selection);
  useLayoutEffect(() => {
    shown.current = selection;
  }, [selection]);

  /** Records the folder shown now too: it may have come from a start, a rescan or a close. */
  const record = useCallback((next: Selection) => {
    const from = shown.current;
    setHistory((h) => visit(from ? visit(h, toVisit(from)) : h, toVisit(next)));
  }, []);

  const target = (dir: -1 | 1) => step(history, dir, (v) => restore(v, entries, selection));
  const canBack = target(-1) !== null;
  const canForward = target(1) !== null;

  const go = useCallback(
    (dir: -1 | 1) => {
      const found = step(history, dir, (v) => restore(v, entries, selection));
      if (!found) return;
      setHistory(found.history);
      const { root, generation, folder } = found.visit;
      jump({ root, generation, id: folder, folder });
    },
    [history, entries, selection, jump],
  );

  // The listeners subscribe once (again for a new direction) and call the latest `go`.
  const latestGo = useRef(go);
  useLayoutEffect(() => {
    latestGo.current = go;
  }, [go]);

  useEffect(() => {
    const side = (e: MouseEvent) => e.button === BACK_BUTTON || e.button === FORWARD_BUTTON;
    // The webview would go through its own page history on these buttons.
    const press = (e: MouseEvent) => {
      if (side(e)) e.preventDefault();
    };
    const release = (e: MouseEvent) => {
      if (!side(e)) return;
      e.preventDefault();
      if (!busy(e.target)) latestGo.current(e.button === BACK_BUTTON ? -1 : 1);
    };
    const key = (e: KeyboardEvent) => {
      const dir = historyKey(e, rtl);
      if (dir === null || typing(e.target)) return;
      e.preventDefault();
      if (!e.repeat && !busy(e.target)) latestGo.current(dir);
    };
    let swipe = idleSwipe;
    // Passive: the swipe never stops the scrolling it shares the wheel events with.
    const wheel = (e: WheelEvent) => {
      const dx = swipeDelta(e);
      if (dx === null) return;
      const r = swipeStep(swipe, dx, e.timeStamp, scrollsAlong(e.target, dx));
      swipe = r.swipe;
      if (r.dir !== null && !typing(document.activeElement) && !busy(e.target)) {
        latestGo.current(historyStep(r.dir, rtl));
      }
    };
    window.addEventListener("mousedown", press);
    window.addEventListener("mouseup", release);
    window.addEventListener("keydown", key);
    window.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("mousedown", press);
      window.removeEventListener("mouseup", release);
      window.removeEventListener("keydown", key);
      window.removeEventListener("wheel", wheel);
    };
  }, [rtl]);

  return {
    record,
    back: () => go(-1),
    forward: () => go(1),
    canBack,
    canForward,
  };
}

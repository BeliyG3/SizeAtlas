import { useEffect, useLayoutEffect, useRef } from "react";
import { busy, typing } from "../features/shell/keyGuards";

interface Keys {
  /** F5: refresh the current folder. */
  onRefresh: () => void;
  /** Ctrl+F5: scan the root of the current folder again. */
  onRescan: () => void;
  /** Delete that no table or tree took: Scan › Move to the trash. */
  onDelete: () => void;
  /** Ctrl+E: File › Export table with the separator used last. */
  onExport: () => void;
}

/**
 * F5, Ctrl+F5, Delete and Ctrl+E anywhere in the window, but not while typing or in a dialog or menu,
 * and not while the key repeats. F5 never reloads the page, as the webview would do by itself.
 */
export function useChangeKeys(keys: Keys) {
  const latest = useRef(keys);
  useLayoutEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Delete") {
        const plain = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
        const free = !e.defaultPrevented && !e.repeat && !typing(e.target) && !busy(e.target);
        if (plain && free) latest.current.onDelete();
        return;
      }
      // By the key's place, so that it works with any keyboard layout.
      if (e.code === "KeyE" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (e.repeat || typing(e.target) || busy(e.target)) return;
        latest.current.onExport();
        return;
      }
      if (e.key !== "F5") return;
      e.preventDefault();
      if (e.repeat || typing(e.target) || busy(e.target)) return;
      if (e.altKey || e.shiftKey || e.metaKey) return;
      if (e.ctrlKey) latest.current.onRescan();
      else latest.current.onRefresh();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
}

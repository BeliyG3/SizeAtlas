import { useEffect, type RefObject } from "react";
import { busy } from "../shell/keyGuards";

/**
 * Ctrl+F (⌘F on macOS), by the key's place so that it works with any keyboard layout: focuses the
 * field and selects its text. Not in an open dialog or menu, which keep the key to themselves.
 */
export function searchKeyDown(e: KeyboardEvent, field: HTMLInputElement | null) {
  const modifier = e.ctrlKey !== e.metaKey;
  if (e.code !== "KeyF" || !modifier || e.shiftKey || e.altKey) return;
  if (e.defaultPrevented || !field || busy(e.target)) return;
  e.preventDefault();
  field.focus();
  field.select();
}

/** Ctrl+F anywhere in the window focuses the search field. */
export function useSearchKey(field: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => searchKeyDown(e, field.current);
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [field]);
}

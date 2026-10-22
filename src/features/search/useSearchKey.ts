import { useEffect, type RefObject } from "react";
import { busy } from "../shell/keyGuards";
import { platform } from "../shell/platform";

/**
 * Cmd+F on a Mac (there Ctrl+F belongs to the text field), Ctrl+F elsewhere; by the key's place,
 * so that it works with any keyboard layout. Focuses the field and selects its text. In an open
 * dialog or menu it only keeps the webview's own find bar away, as F5 and Ctrl+E do.
 */
export function searchKeyDown(
  e: KeyboardEvent,
  field: HTMLInputElement | null,
  mac = platform() === "mac",
) {
  const modifier = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (e.code !== "KeyF" || !modifier || e.shiftKey || e.altKey) return;
  if (e.defaultPrevented || !field) return;
  e.preventDefault();
  if (busy(e.target)) return;
  field.focus();
  field.select();
}

/** Ctrl+F (Cmd+F on a Mac) anywhere in the window focuses the search field. */
export function useSearchKey(field: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => searchKeyDown(e, field.current);
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [field]);
}

import { mirrorArrow } from "../../i18n";

/** Mouse buttons that go back and forward (MouseEvent.button). */
export const BACK_BUTTON = 3;
export const FORWARD_BUTTON = 4;

type Key = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey">;

const ALT_KEYS: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowRight: 1 };
/** By physical key, so ⌘[ and ⌘] work on any keyboard layout. */
const META_CODES: Record<string, -1 | 1> = { BracketLeft: -1, BracketRight: 1 };

/**
 * -1 for Alt+← or ⌘[, 1 for Alt+→ or ⌘] (back and forward through visited folders), else null.
 * Controls that take arrow keys leave these to the history. In right-to-left layouts Alt+→ goes
 * back and Alt+← forward; ⌘[ and ⌘] stay as they are.
 */
export function historyKey(e: Key, rtl: boolean): -1 | 1 | null {
  if (e.ctrlKey || e.shiftKey) return null;
  if (e.altKey && !e.metaKey) return ALT_KEYS[mirrorArrow(e.key, rtl)] ?? null;
  if (e.metaKey && !e.altKey) return META_CODES[e.code] ?? null;
  return null;
}

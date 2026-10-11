/** Mouse buttons that go back and forward (MouseEvent.button). */
export const BACK_BUTTON = 3;
export const FORWARD_BUTTON = 4;

type Key = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey">;

/**
 * -1 for Alt+←, 1 for Alt+→ (back and forward through visited folders), else null. Controls that
 * take arrow keys leave these to the history.
 */
export function historyKey(e: Key): -1 | 1 | null {
  if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return null;
  if (e.key === "ArrowLeft") return -1;
  if (e.key === "ArrowRight") return 1;
  return null;
}

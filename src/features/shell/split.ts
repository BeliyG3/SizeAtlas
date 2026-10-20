/** Smallest size of any pane, in pixels. */
export const MIN_PANE = 120;
/** Thickness of the draggable border, in pixels. */
export const SPLITTER = 6;

const STEP = 16;
const BIG_STEP = 64;

/** A pane size that leaves both panes at least MIN_PANE in a container of `room` pixels. */
export function clampPane(size: number, room: number): number {
  if (!Number.isFinite(size)) return MIN_PANE;
  const max = room - MIN_PANE - SPLITTER;
  return Math.round(Math.max(MIN_PANE, Math.min(size, max)));
}

/**
 * Pixels an arrow key moves the border by on screen, right or down (Shift: more); `row` panes sit
 * side by side.
 */
export function keyStep(key: string, shift: boolean, row: boolean): number | null {
  const step = shift ? BIG_STEP : STEP;
  if (key === (row ? "ArrowLeft" : "ArrowUp")) return -step;
  if (key === (row ? "ArrowRight" : "ArrowDown")) return step;
  return null;
}

/**
 * Size of the `sized` pane after the border moved `delta` pixels on screen (right or down). Side
 * by side, the first pane is the start one: on the right in right-to-left layouts.
 */
export function movePane(
  size: number,
  delta: number,
  sized: "first" | "second",
  row: boolean,
  rtl: boolean,
): number {
  const towardsSecond = row && rtl ? -delta : delta;
  return size + (sized === "first" ? towardsSecond : -towardsSecond);
}

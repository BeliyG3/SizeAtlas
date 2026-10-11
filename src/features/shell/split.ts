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

/** Pixels an arrow key moves the border by (Shift: more); `row` panes sit side by side. */
export function keyStep(key: string, shift: boolean, row: boolean): number | null {
  const step = shift ? BIG_STEP : STEP;
  if (key === (row ? "ArrowLeft" : "ArrowUp")) return -step;
  if (key === (row ? "ArrowRight" : "ArrowDown")) return step;
  return null;
}

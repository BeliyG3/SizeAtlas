/**
 * Two-finger horizontal swipe on a trackpad, read from wheel events as browsers do: the horizontal
 * movement of one gesture adds up until it passes a threshold, which goes back (fingers move right,
 * negative deltaX) or forward once; the rest of the gesture, momentum included, is ignored. A mouse
 * with a tilting wheel counts too: tilting it is just as deliberate.
 */

/** Pixels of horizontal movement that make a swipe. */
export const SWIPE_THRESHOLD = 120;
/** A pause between wheel events this long (ms) ends the gesture. */
export const SWIPE_GAP_MS = 250;

export interface Swipe {
  /** Horizontal movement of the gesture so far. */
  sum: number;
  /** The gesture went back or forward, or scrolled something: it does nothing more. */
  done: boolean;
  /** Time of the gesture's last wheel event. */
  last: number;
}

export const idleSwipe: Swipe = { sum: 0, done: false, last: -Infinity };

type Wheel = Pick<
  WheelEvent,
  "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/**
 * The horizontal movement of a wheel event that may be a swipe, else null: in pixels, mostly
 * horizontal, and without Ctrl or Cmd (zoom, pinch) or Shift (which turns a vertical wheel sideways).
 */
export function swipeDelta(e: Wheel): number | null {
  if (e.deltaMode !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  return Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : null;
}

/**
 * Adds one horizontal wheel movement at `now` (ms). `scrolls` tells that something under the
 * pointer scrolled with it instead: then the whole gesture is left to the scrolling, as Safari does.
 */
export function swipeStep(
  s: Swipe,
  deltaX: number,
  now: number,
  scrolls: boolean,
): { swipe: Swipe; dir: -1 | 1 | null } {
  const current = now - s.last > SWIPE_GAP_MS ? idleSwipe : s;
  if (current.done || scrolls) return { swipe: { sum: 0, done: true, last: now }, dir: null };
  const sum = current.sum + deltaX;
  if (Math.abs(sum) < SWIPE_THRESHOLD) return { swipe: { sum, done: false, last: now }, dir: null };
  return { swipe: { sum: 0, done: true, last: now }, dir: sum < 0 ? -1 : 1 };
}

/**
 * The history step of a swipe going `dir`: mirrored in right-to-left layouts, where the swipe to
 * the left goes back.
 */
export const historyStep = (dir: -1 | 1, rtl: boolean): -1 | 1 =>
  rtl ? (dir === 1 ? -1 : 1) : dir;

export type ScrollBox = Pick<Element, "scrollLeft" | "scrollWidth" | "clientWidth">;

/**
 * Whether a box can still scroll in the direction of `deltaX`, not being at that edge yet. A
 * right-to-left box starts at its right edge: its scrollLeft runs from 0 down to minus the range.
 */
export function canScrollX(box: ScrollBox, deltaX: number, rtl: boolean): boolean {
  const max = box.scrollWidth - box.clientWidth;
  if (max <= 0) return false;
  // Distance from the start edge, and whether the movement goes towards the end one.
  const from = rtl ? -box.scrollLeft : box.scrollLeft;
  const toEnd = rtl ? deltaX < 0 : deltaX > 0;
  // One pixel of slack: fractional scaling leaves scrollLeft just short of the edge.
  return toEnd ? from < max - 1 : from > 0;
}

/** Whether the target or one of its parents scrolls sideways with this movement. */
export function scrollsAlong(target: EventTarget | null, deltaX: number): boolean {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    // Each box by its own direction: the treemap stays left-to-right in every language.
    const { overflowX, direction } = getComputedStyle(el);
    const scrolls = overflowX === "auto" || overflowX === "scroll";
    if (scrolls && canScrollX(el, deltaX, direction === "rtl")) return true;
  }
  return false;
}

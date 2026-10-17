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

export type ScrollBox = Pick<Element, "scrollLeft" | "scrollWidth" | "clientWidth">;

/** Whether a box can still scroll in the direction of `deltaX`, not being at that edge yet. */
export function canScrollX(box: ScrollBox, deltaX: number): boolean {
  const max = box.scrollWidth - box.clientWidth;
  if (max <= 0) return false;
  // One pixel of slack: fractional scaling leaves scrollLeft just short of the edge.
  return deltaX < 0 ? box.scrollLeft > 0 : box.scrollLeft < max - 1;
}

/** Whether the target or one of its parents scrolls sideways with this movement. */
export function scrollsAlong(target: EventTarget | null, deltaX: number): boolean {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const { overflowX } = getComputedStyle(el);
    if ((overflowX === "auto" || overflowX === "scroll") && canScrollX(el, deltaX)) return true;
  }
  return false;
}

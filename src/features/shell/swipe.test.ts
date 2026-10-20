import { describe, expect, it } from "vitest";
import {
  SWIPE_GAP_MS,
  SWIPE_THRESHOLD,
  type Swipe,
  canScrollX,
  historyStep,
  idleSwipe,
  swipeDelta,
  swipeStep,
} from "./swipe";

/** Feeds wheel movements 16 ms apart; returns the directions it went and the final state. */
function feed(deltas: number[], start = idleSwipe, t0 = 0, scrolls = false) {
  let swipe: Swipe = start;
  const dirs: (-1 | 1)[] = [];
  deltas.forEach((d, i) => {
    const r = swipeStep(swipe, d, t0 + i * 16, scrolls);
    swipe = r.swipe;
    if (r.dir !== null) dirs.push(r.dir);
  });
  return { dirs, swipe };
}

const wheel = (deltaX: number, deltaY: number, mods: Partial<WheelEvent> = {}) => ({
  deltaX,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("swipeDelta", () => {
  it("takes mostly horizontal pixel movement", () => {
    expect(swipeDelta(wheel(-30, 5))).toBe(-30);
    expect(swipeDelta(wheel(5, 30))).toBeNull();
  });

  it("ignores lines and pages, zoom and Shift", () => {
    expect(swipeDelta(wheel(-30, 0, { deltaMode: 1 }))).toBeNull();
    expect(swipeDelta(wheel(-30, 0, { ctrlKey: true }))).toBeNull();
    expect(swipeDelta(wheel(-30, 0, { metaKey: true }))).toBeNull();
    expect(swipeDelta(wheel(-30, 0, { shiftKey: true }))).toBeNull();
  });
});

describe("swipeStep", () => {
  it("goes back on a swipe to the right and forward on one to the left", () => {
    expect(feed([-50, -50, -50]).dirs).toEqual([-1]);
    expect(feed([50, 50, 50]).dirs).toEqual([1]);
  });

  it("waits for the threshold", () => {
    expect(feed([-(SWIPE_THRESHOLD - 1)]).dirs).toEqual([]);
    expect(feed([-SWIPE_THRESHOLD]).dirs).toEqual([-1]);
    // Movement back and forth adds up to little.
    expect(feed([-100, 90, -100]).dirs).toEqual([]);
  });

  it("fires once per gesture, momentum included", () => {
    expect(feed(Array<number>(40).fill(-50)).dirs).toEqual([-1]);
  });

  it("starts a new gesture after a pause", () => {
    const first = feed([-150]);
    expect(feed([-150], first.swipe, first.swipe.last + SWIPE_GAP_MS + 1).dirs).toEqual([-1]);
    expect(feed([-150], first.swipe, first.swipe.last + SWIPE_GAP_MS).dirs).toEqual([]);
  });

  it("forgets a small movement after a pause", () => {
    const first = feed([-100]);
    expect(feed([-30], first.swipe, first.swipe.last + SWIPE_GAP_MS + 1).dirs).toEqual([]);
  });

  it("goes the other way in right-to-left layouts: a swipe to the left goes back", () => {
    expect(historyStep(1, true)).toBe(-1);
    expect(historyStep(-1, true)).toBe(1);
    expect(historyStep(-1, false)).toBe(-1);
  });

  it("leaves a gesture that scrolled something to the scrolling", () => {
    const scrolled = feed([-50], idleSwipe, 0, true);
    expect(scrolled.dirs).toEqual([]);
    // The scroller reached its edge, but the same gesture still does not go back.
    expect(feed([-200], scrolled.swipe, 16).dirs).toEqual([]);
  });
});

describe("canScrollX", () => {
  const box = (scrollLeft: number, scrollWidth = 1000, clientWidth = 400) => ({
    scrollLeft,
    scrollWidth,
    clientWidth,
  });

  it("is false for a box that fits", () => {
    expect(canScrollX(box(0, 400), -10, false)).toBe(false);
    expect(canScrollX(box(0, 400), 10, false)).toBe(false);
  });

  it("is false at the edge the movement goes to", () => {
    expect(canScrollX(box(0), -10, false)).toBe(false);
    expect(canScrollX(box(600), 10, false)).toBe(false);
    expect(canScrollX(box(599.5), 10, false)).toBe(false);
  });

  it("is true away from that edge", () => {
    expect(canScrollX(box(0), 10, false)).toBe(true);
    expect(canScrollX(box(600), -10, false)).toBe(true);
    expect(canScrollX(box(300), -10, false)).toBe(true);
  });

  it("reads the edges of a right-to-left box, where scrollLeft runs from 0 down", () => {
    // At the right edge (the start).
    expect(canScrollX(box(0), 40, true)).toBe(false);
    expect(canScrollX(box(0), -40, true)).toBe(true);
    // At the left edge (the end).
    expect(canScrollX(box(-600), -40, true)).toBe(false);
    expect(canScrollX(box(-599.5), -40, true)).toBe(false);
    expect(canScrollX(box(-600), 40, true)).toBe(true);
  });
});

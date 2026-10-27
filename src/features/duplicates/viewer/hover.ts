// Where the larger picture of a hovered group thumbnail goes: pure functions of sizes in pixels.

import type { Point, Size } from "./zoom";

/** How long the pointer rests on a thumbnail before the larger picture shows, ms. */
export const HOVER_DELAY = 400;
/** The largest side of the larger picture, px. */
export const HOVER_SIZE = 320;

/** The popup in a window of `view`: never larger than the window. */
export const popupSize = (view: Size): Size => ({
  w: Math.min(HOVER_SIZE, view.w),
  h: Math.min(HOVER_SIZE, view.h),
});

/** The popup of a picture of `natural` size: its shape, as large as `limit` allows. */
export const fitPopup = (natural: Size, limit: Size): Size => {
  if (natural.w <= 0 || natural.h <= 0) return limit;
  const scale = Math.min(limit.w / natural.w, limit.h / natural.h);
  return { w: Math.round(natural.w * scale), h: Math.round(natural.h * scale) };
};

/** One axis: after the pointer by `gap`, before it when that would leave the view, then clamped. */
const place = (at: number, popup: number, view: number, gap: number) => {
  const after = at + gap;
  const start = after + popup > view ? at - gap - popup : after;
  return Math.max(0, Math.min(start, view - popup));
};

/** The top-left of the popup: below-right of the pointer, flipped per axis, inside `view`. */
export const placePopup = (at: Point, popup: Size, view: Size, gap = 12): Point => ({
  x: place(at.x, popup.w, view.w, gap),
  y: place(at.y, popup.h, view.h, gap),
});

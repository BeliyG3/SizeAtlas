// Zoom and pan of a picture in a box: pure functions of sizes in pixels, so the view never needs a
// DOM to be tested. Any size of zero or less (before the picture loads, a minimized window) gives
// the identity view, never NaN.

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The picture drawn at `scale`, its top-left at (`x`, `y`) in the box, px. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MAX_SCALE = 8;
/** The zoom factor of one wheel step. */
export const WHEEL_STEP = 1.2;

const IDENTITY: View = { scale: 1, x: 0, y: 0 };

const degenerate = (image: Size, box: Size) =>
  !(image.w > 0 && image.h > 0 && box.w > 0 && box.h > 0);

/** One axis: centered while the picture is narrower than the box, else never leaving a gap. */
const axis = (at: number, picture: number, box: number) =>
  picture <= box ? (box - picture) / 2 : Math.min(0, Math.max(box - picture, at));

/** `scale` within fit..MAX_SCALE, the point `at` of the box kept on the same picture point. */
function scaleAt(view: View, image: Size, box: Size, scale: number, at: Point): View {
  if (degenerate(image, box)) return IDENTITY;
  const s = Math.min(MAX_SCALE, Math.max(fitView(image, box).scale, scale));
  const x = at.x - ((at.x - view.x) / view.scale) * s;
  const y = at.y - ((at.y - view.y) / view.scale) * s;
  return { scale: s, x: axis(x, image.w * s, box.w), y: axis(y, image.h * s, box.h) };
}

/** The whole picture in the box, centered, never above its actual size. */
export function fitView(image: Size, box: Size): View {
  if (degenerate(image, box)) return IDENTITY;
  const scale = Math.min(1, box.w / image.w, box.h / image.h);
  return { scale, x: (box.w - image.w * scale) / 2, y: (box.h - image.h * scale) / 2 };
}

export function zoomAt(view: View, image: Size, box: Size, factor: number, at: Point): View {
  return scaleAt(view, image, box, view.scale * factor, at);
}

export function panBy(view: View, image: Size, box: Size, dx: number, dy: number): View {
  if (degenerate(image, box)) return IDENTITY;
  const { scale } = view;
  return {
    scale,
    x: axis(view.x + dx, image.w * scale, box.w),
    y: axis(view.y + dy, image.h * scale, box.h),
  };
}

export function isFit(view: View, image: Size, box: Size): boolean {
  return Math.abs(view.scale - fitView(image, box).scale) < 1e-9;
}

/** Fit → the actual size at `at`; anything else → fit. */
export function toggleActual(view: View, image: Size, box: Size, at: Point): View {
  return isFit(view, image, box) ? scaleAt(view, image, box, 1, at) : fitView(image, box);
}

/** The picture is larger than the box: it can be dragged. */
export function canPan(view: View, image: Size, box: Size): boolean {
  return image.w * view.scale > box.w + 0.5 || image.h * view.scale > box.h + 0.5;
}

/** Distance a menu keeps from the window edges. */
export const EDGE = 4;

/**
 * Left edge of a menu `width` wide opened at `x` in a window `room` wide: its inline-start edge
 * at `x`, so in right-to-left layouts it opens to the left of `x`. Kept inside the window.
 */
export function menuLeft(x: number, width: number, room: number, rtl: boolean): number {
  return Math.max(EDGE, Math.min(rtl ? x - width : x, room - width - EDGE));
}

/** Where a menu for an element opens: `inset` pixels in from the inline-start edge of its box. */
export const anchorX = (box: Pick<DOMRect, "left" | "right">, rtl: boolean, inset = 0) =>
  rtl ? box.right - inset : box.left + inset;

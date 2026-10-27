import { describe, expect, it } from "vitest";
import { MAX_SCALE, fitView, isFit, panBy, toggleActual, zoomAt } from "./zoom";

const wide = { w: 2000, h: 1000 };
const square = { w: 1000, h: 1000 };

describe("zoom", () => {
  it("fits_and_centers", () => {
    expect(fitView(wide, square)).toEqual({ scale: 0.5, x: 0, y: 250 });
  });

  it("never_fits_above_actual_size", () => {
    expect(fitView({ w: 16, h: 16 }, { w: 800, h: 600 })).toEqual({ scale: 1, x: 392, y: 292 });
  });

  it("zooms_at_the_pointer", () => {
    const v = fitView(wide, square);
    expect(zoomAt(v, wide, square, 2, { x: 500, y: 500 })).toEqual({ scale: 1, x: -500, y: 0 });
  });

  it("clamps_the_scale", () => {
    let v = fitView(wide, square);
    for (let i = 0; i < 100; i++) v = zoomAt(v, wide, square, 1.2, { x: 10, y: 10 });
    expect(v.scale).toBe(MAX_SCALE);
    for (let i = 0; i < 100; i++) v = zoomAt(v, wide, square, 1 / 1.2, { x: 10, y: 10 });
    expect(v).toEqual(fitView(wide, square));
  });

  it("pans_only_within_the_picture", () => {
    const v = { scale: 1, x: -500, y: 0 };
    expect(panBy(v, wide, square, 5000, 0).x).toBe(0);
    expect(panBy(v, wide, square, -5000, 0).x).toBe(-1000);
    expect(panBy(v, wide, square, 0, 300).y).toBe(0);
    expect(panBy(v, wide, square, 0, -300).y).toBe(0);
  });

  it("toggles_fit_and_actual_size", () => {
    const fit = fitView(wide, square);
    expect(isFit(fit, wide, square)).toBe(true);
    const actual = toggleActual(fit, wide, square, { x: 500, y: 500 });
    expect(actual.scale).toBe(1);
    expect(isFit(actual, wide, square)).toBe(false);
    expect(toggleActual(actual, wide, square, { x: 500, y: 500 })).toEqual(fit);
  });

  it("degenerate_sizes", () => {
    const none = { scale: 1, x: 0, y: 0 };
    expect(fitView({ w: 0, h: 0 }, { w: 800, h: 600 })).toEqual(none);
    expect(fitView({ w: 100, h: 100 }, { w: 0, h: 0 })).toEqual(none);
    expect(zoomAt(none, { w: 0, h: 0 }, square, 2, { x: 1, y: 1 })).toEqual(none);
    expect(panBy(none, wide, { w: 0, h: -1 }, 5, 5)).toEqual(none);
  });
});

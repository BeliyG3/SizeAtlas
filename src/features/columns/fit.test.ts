import { describe, expect, it } from "vitest";
import { MAX_WIDTH, MIN_WIDTH, clampWidth, fitWidth, parseWidths, resizeStep } from "./fit";

describe("column widths", () => {
  it("clamp to the allowed range and round", () => {
    expect(clampWidth(10)).toBe(MIN_WIDTH);
    expect(clampWidth(99_999)).toBe(MAX_WIDTH);
    expect(clampWidth(100.4)).toBe(100);
  });

  it("fit the widest content with a little slack, inside the range", () => {
    expect(fitWidth(100.2)).toBe(105);
    expect(fitWidth(0)).toBe(MIN_WIDTH);
    expect(fitWidth(5000)).toBe(MAX_WIDTH);
  });

  it("move a border by a step per arrow key, more with Shift", () => {
    expect(resizeStep("ArrowRight", false)).toBe(8);
    expect(resizeStep("ArrowLeft", false)).toBe(-8);
    expect(resizeStep("ArrowRight", true)).toBe(32);
    expect(resizeStep("Enter", false)).toBeNull();
  });

  it("restore stored widths over the defaults and ignore garbage", () => {
    const defaults = { name: 280, size: 96 } as const;
    expect(parseWidths(null, defaults)).toEqual(defaults);
    expect(parseWidths("not json", defaults)).toEqual(defaults);
    expect(parseWidths("[1, 2]", defaults)).toEqual(defaults);
    expect(parseWidths("42", defaults)).toEqual(defaults);
    // The shape stored before columns could be hidden or moved: one width per column id.
    expect(parseWidths(JSON.stringify({ name: 400.4, size: 10, ghost: 99 }), defaults)).toEqual({
      name: 400,
      size: 96,
    });
    expect(parseWidths(JSON.stringify({ name: "wide" }), defaults)).toEqual(defaults);
  });
});

import { describe, expect, it } from "vitest";
import { ROW_HEIGHT, pagesFor, rowTarget, scrollToShow, visibleRange } from "./pages";

describe("virtual rows", () => {
  it("render the visible rows and a margin", () => {
    expect(visibleRange(0, 480, 300_000)).toEqual({ first: 0, last: 42 });
    expect(visibleRange(ROW_HEIGHT * 1000, 480, 300_000)).toEqual({ first: 980, last: 1042 });
    expect(visibleRange(0, 480, 5)).toEqual({ first: 0, last: 5 });
    expect(visibleRange(5000, 480, 0)).toEqual({ first: 0, last: 0 });
  });

  it("reach the end of a folder with 300 000 entries", () => {
    const range = visibleRange(300_000 * ROW_HEIGHT - 480, 480, 300_000);
    expect(range.last).toBe(300_000);
    expect(pagesFor(range.first, range.last)).toEqual([1499]);
  });

  it("fetch whole pages", () => {
    expect(pagesFor(190, 410)).toEqual([0, 1, 2]);
    expect(pagesFor(0, 0)).toEqual([]);
  });

  it("scroll only as far as needed", () => {
    expect(scrollToShow(10, 0, 480)).toBeNull();
    expect(scrollToShow(100, 0, 480)).toBe(100 * ROW_HEIGHT + ROW_HEIGHT - 480);
    expect(scrollToShow(5, 1000, 480)).toBe(5 * ROW_HEIGHT);
  });

  it("move the cursor by key", () => {
    expect(rowTarget("ArrowDown", 4, 10, 50)).toBe(5);
    expect(rowTarget("ArrowUp", -1, 10, 50)).toBe(-2);
    expect(rowTarget("PageDown", 4, 10, 50)).toBe(14);
    expect(rowTarget("PageUp", 4, 10, 50)).toBe(-6);
    expect([rowTarget("Home", 4, 10, 50), rowTarget("End", 4, 10, 50)]).toEqual([0, 49]);
    expect(rowTarget("Enter", 4, 10, 50)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { EDGE, anchorX, menuLeft } from "./place";

describe("menu placement", () => {
  it("opens to the right of x, kept inside the window", () => {
    expect(menuLeft(100, 200, 1000, false)).toBe(100);
    expect(menuLeft(990, 200, 1000, false)).toBe(1000 - 200 - EDGE);
    expect(menuLeft(0, 200, 1000, false)).toBe(EDGE);
  });

  it("opens to the left of x in right-to-left layouts, kept inside the window", () => {
    // A context menu near the right edge: its inline-start (right) edge at the pointer.
    expect(menuLeft(990, 200, 1000, true)).toBe(790);
    // A submenu: to the left of its parent item, whose left edge is at 500.
    expect(menuLeft(500, 200, 1000, true)).toBe(300);
    expect(menuLeft(100, 200, 1000, true)).toBe(EDGE);
    expect(menuLeft(1200, 200, 1000, true)).toBe(1000 - 200 - EDGE);
  });

  it("anchors at the inline-start edge of a box", () => {
    const box = { left: 100, right: 400 };
    expect(anchorX(box, false)).toBe(100);
    expect(anchorX(box, true)).toBe(400);
    expect(anchorX(box, false, 24)).toBe(124);
    expect(anchorX(box, true, 24)).toBe(376);
  });
});

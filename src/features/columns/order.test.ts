import { describe, expect, it } from "vitest";
import { dropEdge, dropIndex, ghostLeft, moveColumn, parseOrder, repairOrder } from "./order";

const DEFAULTS = ["name", "size", "used", "free"] as const;

describe("column order", () => {
  it("moves a column before another, or to the end", () => {
    expect(moveColumn(DEFAULTS, "free", "size")).toEqual(["name", "free", "size", "used"]);
    expect(moveColumn(DEFAULTS, "name", null)).toEqual(["size", "used", "free", "name"]);
    expect(moveColumn(DEFAULTS, "size", "size")).toEqual([...DEFAULTS]);
    expect(moveColumn(DEFAULTS, "size", "name")).toEqual(["size", "name", "used", "free"]);
  });

  it("keeps a pinned column first", () => {
    expect(moveColumn(DEFAULTS, "name", null, "name")).toEqual([...DEFAULTS]);
    expect(moveColumn(DEFAULTS, "free", "name", "name")).toEqual(["name", "free", "size", "used"]);
  });

  it("repairs a stored order: known ids once, missing ones appended", () => {
    expect(repairOrder(["free", "x", "free", 3, "name"], DEFAULTS)).toEqual([
      "free",
      "name",
      "size",
      "used",
    ]);
    expect(repairOrder("name", DEFAULTS)).toEqual([...DEFAULTS]);
  });

  it("parses a stored order and falls back to the defaults on garbage", () => {
    expect(parseOrder(null, DEFAULTS)).toEqual([...DEFAULTS]);
    expect(parseOrder("not json", DEFAULTS)).toEqual([...DEFAULTS]);
    expect(parseOrder('{"a":1}', DEFAULTS)).toEqual([...DEFAULTS]);
    expect(parseOrder('["size","name"]', ["name", "size"])).toEqual(["size", "name"]);
  });

  it("finds where a dragged header drops from the column centers", () => {
    const centers = [50, 150, 250];
    expect(dropIndex(centers, 10, false)).toBe(0);
    expect(dropIndex(centers, 149, false)).toBe(1);
    expect(dropIndex(centers, 151, false)).toBe(2);
    expect(dropIndex(centers, 999, false)).toBe(3);
  });

  it("counts from the right in right-to-left layouts", () => {
    // Columns in order from right to left.
    const centers = [250, 150, 50];
    expect(dropIndex(centers, 999, true)).toBe(0);
    expect(dropIndex(centers, 151, true)).toBe(1);
    expect(dropIndex(centers, 149, true)).toBe(2);
    expect(dropIndex(centers, 10, true)).toBe(3);
  });

  it("draws the drop line at the start edge of the column it drops before", () => {
    const ltr = [
      { left: 0, right: 100 },
      { left: 100, right: 200 },
    ];
    expect(dropEdge(ltr, 1, false)).toBe(100);
    expect(dropEdge(ltr, 2, false)).toBe(200);
    const rtl = [
      { left: 100, right: 200 },
      { left: 0, right: 100 },
    ];
    expect(dropEdge(rtl, 0, true)).toBe(200);
    expect(dropEdge(rtl, 2, true)).toBe(0);
  });

  it("keeps the drag ghost inside the header", () => {
    // Header from x=100 to x=500, a ghost 80 wide grabbed 30 from its left edge.
    expect(ghostLeft(250, 30, 80, 100, 500)).toBe(220);
    expect(ghostLeft(110, 30, 80, 100, 500)).toBe(100);
    expect(ghostLeft(600, 30, 80, 100, 500)).toBe(420);
  });
});

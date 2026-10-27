import { describe, expect, it } from "vitest";
import type { CityData, CityRect } from "./bytes";
import {
  buildCity,
  buildingHeight,
  focusIn,
  MAX_HEIGHT,
  MIN_HEIGHT,
  PLATE,
  WORLD,
  type Block,
} from "./model";

const DIR = 255;

function rect(
  id: number,
  depth: number,
  [x, y, w, h]: [number, number, number, number],
  size: number,
  kind: "dir" | "open" | "file",
): CityRect {
  const isDir = kind !== "file";
  return {
    id,
    depth,
    x,
    y,
    w,
    h,
    size,
    isDir,
    expanded: kind === "open",
    category: isDir ? DIR : 2,
  };
}

// Layout pixels of the 1000×1000 field; parents before children, children 1 px inside.
const data: CityData = {
  generation: 1,
  rev: 1,
  approximate: false,
  rects: [
    rect(1, 0, [0, 0, 500, 1000], 600, "open"),
    rect(2, 0, [500, 0, 500, 500], 300, "open"),
    rect(7, 0, [500, 500, 500, 500], 900, "dir"),
    rect(3, 1, [1, 1, 498, 600], 400, "file"),
    rect(4, 1, [1, 601, 498, 398], 200, "open"),
    rect(5, 1, [501, 1, 498, 498], 100, "file"),
    rect(6, 2, [2, 602, 496, 396], 200, "file"),
  ],
};

function byId(blocks: Block[]): Map<number, Block> {
  return new Map(blocks.map((b) => [b.id, b]));
}

describe("buildingHeight", () => {
  it("grows with the size and is capped", () => {
    expect(buildingHeight(0, 100)).toBe(MIN_HEIGHT);
    expect(buildingHeight(25, 100)).toBeLessThan(buildingHeight(64, 100));
    expect(buildingHeight(64, 100)).toBeLessThan(buildingHeight(100, 100));
    expect(buildingHeight(100, 100)).toBe(MAX_HEIGHT);
    expect(buildingHeight(500, 100)).toBe(MAX_HEIGHT);
    expect(buildingHeight(5, 0)).toBe(MIN_HEIGHT);
  });
});

describe("buildCity", () => {
  const { blocks, focusBox, bounds } = buildCity(data, null);
  const b = byId(blocks);

  it("maps the field onto the world and trims plates a little", () => {
    const a = b.get(1)!;
    expect(a.kind).toBe("plate");
    expect(a.x).toBeCloseTo(WORLD / 4);
    expect(a.z).toBeCloseTo(WORLD / 2);
    expect(a.w).toBeCloseTo(WORLD / 2 - 0.08);
    expect(a.d).toBeCloseTo(WORLD - 0.08);
  });

  it("stacks folder plates by depth", () => {
    expect(b.get(1)).toMatchObject({ y: 0, h: PLATE });
    expect(b.get(4)!.y).toBeCloseTo(PLATE);
    expect(b.get(4)!.h).toBe(PLATE);
  });

  it("stands files on their plate", () => {
    const plate = b.get(4)!;
    expect(b.get(6)!.y).toBeCloseTo(plate.y + plate.h);
    expect(b.get(3)!.y).toBeCloseTo(b.get(1)!.y + PLATE);
    expect(b.get(3)!.kind).toBe("building");
  });

  it("draws an unexpanded folder as a building, the tallest one capped", () => {
    const solid = b.get(7)!;
    expect(solid.kind).toBe("dirBuilding");
    expect(solid.isDir).toBe(true);
    expect(solid.h).toBeGreaterThan(PLATE);
    expect(solid.h).toBe(MAX_HEIGHT);
    expect(Math.max(...blocks.map((x) => x.h))).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(b.get(3)!.h).toBeCloseTo(buildingHeight(400, 900));
  });

  it("lights everything and bounds the whole city without a focus", () => {
    expect(blocks.some((x) => x.dim)).toBe(false);
    expect(focusBox).toBeNull();
    expect(bounds.min).toEqual([0, 0, 0]);
    expect(bounds.max).toEqual([WORLD, MAX_HEIGHT, WORLD]);
  });

  it("dims what lies outside the focus, but not the focus and its ancestors", () => {
    const focused = buildCity(data, 4);
    const f = byId(focused.blocks);
    expect([4, 6, 1].map((id) => f.get(id)!.dim)).toEqual([false, false, false]);
    expect([3, 5, 2, 7].map((id) => f.get(id)!.dim)).toEqual([true, true, true, true]);
  });

  it("boxes the focus plate up to the top of what stands on it", () => {
    const { focusBox: box } = buildCity(data, 4);
    const plate = b.get(4)!;
    const file = b.get(6)!;
    expect(box!.min[0]).toBeCloseTo(plate.x - plate.w / 2);
    expect(box!.max[2]).toBeCloseTo(plate.z + plate.d / 2);
    expect(box!.min[1]).toBeCloseTo(plate.y);
    expect(box!.max[1]).toBeCloseTo(file.y + file.h);
  });

  it("ignores a focus that is not in the layout", () => {
    const missing = buildCity(data, 42);
    expect(missing.focusBox).toBeNull();
    expect(missing.blocks.some((x) => x.dim)).toBe(false);
  });
});

describe("focusIn", () => {
  it("picks the deepest laid-out folder of the path", () => {
    expect(focusIn(data, [0, 1, 4])).toBe(4);
    // A file's own path → its folder.
    expect(focusIn(data, [0, 1, 4, 6])).toBe(4);
    expect(focusIn(data, [0, 2, 5])).toBe(2);
    // A folder missing from the layout → its nearest laid-out ancestor.
    expect(focusIn(data, [0, 1, 4, 77, 78])).toBe(4);
    // An unexpanded folder is laid out and can be the focus.
    expect(focusIn(data, [0, 7, 80])).toBe(7);
  });

  it("lights the whole city for the root", () => {
    expect(focusIn(data, [0])).toBeNull();
    expect(focusIn(data, [])).toBeNull();
    expect(focusIn(data, [0, 99])).toBeNull();
  });
});

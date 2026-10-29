import { describe, expect, it } from "vitest";
import {
  FILLER_MAX,
  FILLER_MIN,
  MAX_H,
  MIN_H,
  buildWorld,
  buildingHeight,
  focusIn,
} from "./buildings";
import { POLY } from "./map";
import { mapOf, square } from "./map.fixture";

// Root 1 > district 2 > blocks 3 and 4 (houses 5, 6 / 7) and a filler block 2 with fillers;
// the root's loose files make the "rest" district, which carries the root's id.
const map = mapOf([
  square(POLY.island, 1, 1, 1000),
  square(POLY.district, 2, 1, 900),
  square(POLY.district, 1, 1, 100, 60, 0),
  square(POLY.block, 3, 2, 500, 0, 0),
  square(POLY.house, 5, 3, 400, 0, 0, 4),
  square(POLY.house, 6, 3, 100, 5, 0, 4),
  square(POLY.block, 4, 2, 300, 20, 0),
  square(POLY.house, 7, 4, 300, 20, 0, 4),
  square(POLY.block, 2, 2, 100, 40, 0),
  square(POLY.filler, 2, 2, 60, 40, 0, 4),
  square(POLY.filler, 2, 2, 40, 45, 0, 4),
]);

describe("buildingHeight", () => {
  it("houses rise with the square root of the size", () => {
    expect(buildingHeight(0, 100)).toBe(MIN_H);
    expect(buildingHeight(100, 100)).toBe(MAX_H);
    expect(buildingHeight(25, 100)).toBeCloseTo(MIN_H + (MAX_H - MIN_H) / 2);
    expect(buildingHeight(5, 0)).toBe(MIN_H);
  });
});

describe("buildWorld", () => {
  it("fillers stay low and are the same every time", () => {
    const a = buildWorld(map, null).buildings.filter((b) => b.kind === "filler");
    const b = buildWorld(map, null).buildings.filter((x) => x.kind === "filler");
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.h)).toEqual(b.map((x) => x.h));
    for (const f of a) {
      expect(f.h).toBeGreaterThanOrEqual(FILLER_MIN);
      expect(f.h).toBeLessThanOrEqual(FILLER_MAX);
    }
  });

  it("measures the houses against the biggest one and finds their district", () => {
    const world = buildWorld(map, null);
    const houses = world.buildings.filter((b) => b.kind === "folder");
    expect(houses.map((h) => h.h)).toEqual([
      buildingHeight(400, 400),
      buildingHeight(100, 400),
      buildingHeight(300, 400),
    ]);
    expect(world.tallest).toBe(400);
    expect(world.buildings.every((b) => b.district === 2)).toBe(true);
    expect(world.focusBox).toBeNull();
    expect(world.bounds.max[1]).toBe(MAX_H);
  });

  it("focus dims houses outside the folder", () => {
    const dimmed = (focus: number | null) =>
      buildWorld(map, focus)
        .buildings.filter((b) => b.dim)
        .map((b) => b.id + "/" + b.parent);
    expect(dimmed(null)).toEqual([]);
    // A block: its houses are lit, the neighbouring block and the fillers are dark.
    expect(dimmed(3)).toEqual(["7/4", "2/2", "2/2"]);
    // A district: all its blocks are lit.
    expect(dimmed(2)).toEqual([]);
    // A house: only itself.
    expect(dimmed(6)).toEqual(["5/3", "7/4", "2/2", "2/2"]);
  });

  it("boxes the focused folder", () => {
    const box = buildWorld(map, 3).focusBox;
    expect(box?.min).toEqual([0, 0, 0]);
    expect(box?.max[0]).toBe(10);
    expect(box?.max[2]).toBe(10);
    expect(box?.max[1]).toBe(MAX_H);
  });
});

describe("focusIn", () => {
  it("picks the deepest folder that has a polygon", () => {
    expect(focusIn(map, [1])).toBeNull();
    expect(focusIn(map, [])).toBeNull();
    expect(focusIn(map, [1, 2, 3])).toBe(3);
    expect(focusIn(map, [1, 2, 3, 5])).toBe(5);
    // A folder without a polygon (a file's folder lost its house): the nearest one above.
    expect(focusIn(map, [1, 2, 3, 99])).toBe(3);
    // A folder replaced by its subfolders has no polygon: the root above it gives no focus.
    expect(focusIn(map, [1, 99])).toBeNull();
  });
});

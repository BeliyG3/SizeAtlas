import { describe, expect, it } from "vitest";
import { mergeIslands } from "./archipelago";
import { buildWorld } from "./buildings";
import { POLY } from "./map";
import { mapOf, square } from "./map.fixture";
import { islandBox, overviewBox } from "./views";

// An island 100 m square with two houses in its block; two of them side by side, 300 m apart.
const island = (generation: number) =>
  mapOf(
    [
      square(POLY.district, 1, 1, 10, 0, 0, 100),
      square(POLY.block, 2, 1, 10, 0, 0, 100),
      square(POLY.house, 5, 2, 10, 10, 10, 20),
      square(POLY.house, 6, 2, 40, 60, 60, 30),
    ],
    { generation },
  );
const world = buildWorld(
  mergeIslands(
    [
      { map: island(1), x: 0, z: 0 },
      { map: island(2), x: 300, z: 0 },
    ],
    [],
  ),
  null,
);

describe("islandBox", () => {
  it("holds every house of the island and stops short of the next island", () => {
    const box = islandBox(world, 0)!;
    const houses = world.buildings.filter((b) => b.island === 0);
    expect(houses.length).toBe(2);
    for (const b of houses) {
      for (let i = 0; i < b.points.length; i += 2) {
        expect(b.points[i]).toBeGreaterThanOrEqual(box.min[0]);
        expect(b.points[i]).toBeLessThanOrEqual(box.max[0]);
        expect(b.points[i + 1]).toBeGreaterThanOrEqual(box.min[2]);
        expect(b.points[i + 1]).toBeLessThanOrEqual(box.max[2]);
      }
      expect(b.h).toBeLessThanOrEqual(box.max[1]);
    }
    expect(box.max[1]).toBe(Math.max(...houses.map((b) => b.h)));
    // The middle of island 1 is at x = 350.
    expect(box.max[0]).toBeLessThan(350);
    expect(islandBox(world, 1)!.min[0]).toBeGreaterThan(box.max[0]);
  });

  it("adds a shore of a tenth of the island around its polygons", () => {
    const box = islandBox(world, 0)!;
    expect(box.min[0]).toBeCloseTo(-10, 5);
    expect(box.min[2]).toBeCloseTo(-10, 5);
    expect(box.max[0]).toBeCloseTo(110, 5);
    expect(box.max[2]).toBeCloseTo(110, 5);
    expect(box.min[1]).toBe(0);
  });

  it("is null for an island with no polygon", () => {
    expect(islandBox(world, 2)).toBeNull();
  });
});

describe("overviewBox", () => {
  it("is the whole archipelago with its shore", () => {
    const box = overviewBox(world);
    expect(box.min[0]).toBeLessThan(0);
    expect(box.max[0]).toBeGreaterThan(400);
  });
});

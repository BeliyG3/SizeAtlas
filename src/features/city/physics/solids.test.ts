import { describe, expect, it } from "vitest";
import { buildWorld } from "../world/buildings";
import { BRIDGE_RISE, POLY, ROAD } from "../world/map";
import { mapOf, square } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { createSolids } from "./solids";
import { canalWorld } from "./world.fixture";

describe("createSolids", () => {
  const { solids } = canalWorld([
    { x: 20, z: 20, w: 10, d: 10, h: 20 },
    { x: 150, z: 70, w: 10, d: 10, h: 35 },
  ]);

  it("a house's roof is what stands there; the street is the ground", () => {
    expect(solids.heightAt(25, 25)).toBe(20);
    expect(solids.roofAt(25, 25)).toBe(20);
    expect(solids.heightAt(40, 25)).toBe(0);
    expect(solids.roofAt(40, 25)).toBeNull();
    expect(solids.isWater(40, 25)).toBe(false);
  });

  it("the bridge deck stands over the canal; the canal beside it is water", () => {
    expect(solids.heightAt(100, 50)).toBeCloseTo(BRIDGE_RISE);
    expect(solids.isWater(100, 50)).toBe(false);
    expect(solids.isWater(100, 50 + 4.9)).toBe(false);
    expect(solids.isWater(100, 80)).toBe(true);
    expect(solids.heightAt(100, 80)).toBe(0);
  });

  it("the deck comes down to the ground at the ends that meet the street", () => {
    expect(solids.heightAt(80, 50)).toBe(0);
    expect(solids.heightAt(76, 50)).toBe(0);
    const up = [80, 82, 84, 86, 88].map((x) => solids.heightAt(x, 50));
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThan(up[i - 1]);
    expect(solids.heightAt(88, 50)).toBeCloseTo(BRIDGE_RISE);
  });

  it("a deck over the body's top passes overhead", () => {
    expect(solids.heightAt(100, 50, 0.5)).toBe(0);
    expect(solids.heightAt(100, 50, 2)).toBeCloseTo(BRIDGE_RISE);
  });

  it("past the island is the sea", () => {
    expect(solids.isWater(-5, 50)).toBe(true);
    expect(solids.isWater(500, 50)).toBe(true);
    expect(solids.heightAt(500, 50)).toBe(0);
  });

  it("knows the tallest house and the bounds", () => {
    expect(solids.tallest).toBe(35);
    expect(solids.bounds).toEqual({ minX: 0, minZ: 0, maxX: 200, maxZ: 100 });
  });

  it("answers 10 000 queries over 20 000 houses in under 50 ms", () => {
    const side = 142;
    const polys = [square(POLY.island, 1, 1, 1, 0, 0, side * 15)];
    for (let i = 0; i < side * side; i++) {
      polys.push(
        square(POLY.house, 2 + i, 1, 1 + (i % 97), (i % side) * 15, Math.floor(i / side) * 15, 10),
      );
    }
    const nodes = new Float32Array([0, 1000, side * 15, 1000]);
    const edges = [{ a: 0, b: 1, cls: ROAD.highway, bridge: true, liftA: 1, liftB: 1 }];
    const map = mapOf(polys, { width: side * 15, height: side * 15, nodes, edges });
    const world = buildWorld(map, null);
    expect(world.buildings.length).toBeGreaterThanOrEqual(20_000);
    const s = createSolids(world, buildRoads(map));
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * side * 15;
    const run = () => {
      let sum = 0;
      for (let i = 0; i < 10_000; i++) {
        const [x, z] = [rand(), rand()];
        sum += s.heightAt(x, z) + (s.isWater(x, z) ? 1 : 0) + (s.roofAt(x, z) ?? 0);
      }
      return sum;
    };
    run();
    const t = performance.now();
    expect(run()).toBeGreaterThan(0);
    const ms = performance.now() - t;
    console.info(`10 000 solids queries: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  });
});

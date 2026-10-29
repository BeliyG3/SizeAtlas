import { describe, expect, it } from "vitest";
import { buildWorld } from "../world/buildings";
import { POLY } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { CELL, insidePoly } from "./bins";
import { createRegion, inRegion } from "./region";
import { createSolids } from "./solids";

/** An island coast of `n` points around (2000, 2000), some 1500 m out, wavy at three scales. */
function coast(n = 2000): Float32Array {
  const points = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = 1500 + 80 * Math.sin(7 * a) + 30 * Math.sin(31 * a) + 10 * Math.sin(97 * a);
    points[i * 2] = 2000 + r * Math.cos(a);
    points[i * 2 + 1] = 2000 + r * Math.sin(a);
  }
  return points;
}

function random(seed = 1) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const SIDE = 4000;
const N = Math.ceil(SIDE / CELL);

describe("inRegion", () => {
  it("agrees with the polygon test, near the coast and far from it", () => {
    const p = coast();
    const r = createRegion([p], N, N);
    const rand = random();
    for (let i = 0; i < 20_000; i++) {
      const [x, z] = [rand() * SIDE, rand() * SIDE];
      expect(inRegion(r, x, z)).toBe(insidePoly(p, x, z));
    }
  });

  it("agrees where the outline runs along the grid lines", () => {
    // Corners on cell corners; points on the cell lines, never on the outline.
    const p = new Float32Array([
      0,
      0,
      4 * CELL,
      0,
      4 * CELL,
      2 * CELL,
      2 * CELL,
      3 * CELL,
      0,
      3 * CELL,
    ]);
    const holes = new Float32Array([
      CELL,
      CELL,
      2 * CELL,
      CELL,
      2 * CELL,
      2 * CELL,
      CELL,
      2 * CELL,
    ]);
    const r = createRegion([p, holes], 8, 8);
    for (let x = 0.5; x < 8 * CELL; x += CELL / 4) {
      for (let z = 0; z < 8 * CELL; z += CELL / 2) {
        const want = insidePoly(p, x, z) !== insidePoly(holes, x, z);
        expect(inRegion(r, x, z), `${x}, ${z}`).toBe(want);
      }
    }
    expect(inRegion(r, -1, 10)).toBe(false);
  });

  it("tells the water from the land on a 2 000-point coast fast enough for 150 cars", () => {
    const map = mapOf(
      [{ island: 0, kind: POLY.island, id: 1, parent: 1, size: 1, points: coast() }],
      { width: SIDE, height: SIDE },
    );
    const s = createSolids(buildWorld(map, null), buildRoads(map));
    // A frame: 150 cars, 3 discs of 13 probes, 2 parts of a step; all at the shore.
    const probes = 150 * 3 * 13 * 2;
    const rand = random(7);
    const xs = new Float64Array(probes);
    const zs = new Float64Array(probes);
    for (let i = 0; i < probes; i++) {
      const a = rand() * 2 * Math.PI;
      const d = 1380 + rand() * 240;
      xs[i] = 2000 + d * Math.cos(a);
      zs[i] = 2000 + d * Math.sin(a);
    }
    const frame = () => {
      let wet = 0;
      for (let i = 0; i < probes; i++) if (s.isWater(xs[i], zs[i])) wet++;
      return wet;
    };
    // Warmed up, the best of a few frames: the steady cost, not the compiler's.
    let wet = 0;
    for (let i = 0; i < 20; i++) wet = frame();
    let ms = Infinity;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      frame();
      ms = Math.min(ms, performance.now() - t);
    }
    console.info(`${probes} isWater probes at a 2 000-point shore: ${ms.toFixed(2)} ms`);
    expect(wet).toBeGreaterThan(probes / 5);
    expect(wet).toBeLessThan((probes * 4) / 5);
    // Some 0.8 ms on the developer's machine; testing the whole coast per probe takes some 30 ms.
    expect(ms).toBeLessThan(2);
  });
});

import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads, roadHalf } from "../world/roads";
import {
  AIR_LANES,
  AIR_SHARE,
  CAR_SPACING,
  MIN_GAP,
  createTraffic,
  laneOffset,
  lanes,
  type Traffic,
} from "./traffic";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false })),
    }),
  );
}

// A straight road east: a highway for 1000 m, then a street for 1000 m (dead ends at both ends).
const line = graphOf(
  [0, 0, 1000, 0, 2000, 0],
  [
    [0, 1, ROAD.highway],
    [1, 2, ROAD.street],
  ],
);

// A 400 m square highway ring (1 600 m) with a 300 m street spur off its corner at (400, 0).
const ring = graphOf(
  [0, 0, 400, 0, 400, 400, 0, 400, 400, -300],
  [
    [0, 1, ROAD.highway],
    [1, 2, ROAD.highway],
    [2, 3, ROAD.highway],
    [3, 0, ROAD.highway],
    [1, 4, ROAD.street],
  ],
);

const run = (t: Traffic, seconds: number, each?: () => void) => {
  for (let n = 0; n < seconds * 60; n++) {
    t.update(1 / 60);
    each?.();
  }
};

/** Distance from (x, z) to the nearest side of the square ring. */
function toRing(x: number, z: number): number {
  const inside = (v: number) => Math.min(Math.max(v, 0), 400);
  const sides = [
    [inside(x), 0],
    [inside(x), 400],
    [0, inside(z)],
    [400, inside(z)],
  ];
  return Math.min(...sides.map(([sx, sz]) => Math.hypot(x - sx, z - sz)));
}

describe("lanes and offsets", () => {
  it("counts lanes per direction and puts them right of the axis", () => {
    expect([ROAD.highway, ROAD.ring, ROAD.ramp, ROAD.street, ROAD.lane].map(lanes)).toEqual([
      2, 2, 2, 1, 0,
    ]);
    expect([laneOffset(ROAD.highway, 0), laneOffset(ROAD.highway, 1)]).toEqual([2, 6]);
    expect(laneOffset(ROAD.street, 0)).toBe(1.5);
  });
});

describe("createTraffic", () => {
  it("cars keep their distance on a lane", () => {
    const t = createTraffic(line, 200, 3);
    let nearest = Infinity;
    let travelled = 0;
    const x0 = Array.from(t.x);
    run(t, 30, () => {
      const lanesSeen = new Map<string, number[]>();
      for (let i = 0; i < t.count; i++) {
        if (t.air[i]) continue;
        const key = `${Math.sign(Math.sin(t.heading[i]))}|${t.z[i].toFixed(2)}`;
        (lanesSeen.get(key) ?? lanesSeen.set(key, []).get(key)!).push(t.x[i]);
      }
      for (const xs of lanesSeen.values()) {
        xs.sort((a, b) => a - b);
        for (let k = 1; k < xs.length; k++) nearest = Math.min(nearest, xs[k] - xs[k - 1]);
      }
    });
    for (let i = 0; i < t.count; i++) travelled += Math.abs(t.x[i] - x0[i]);
    expect(travelled).toBeGreaterThan(1000);
    expect(nearest).toBeGreaterThanOrEqual(MIN_GAP - 0.5);
  });

  it("cars keep their distance across junctions", () => {
    // The true distance of every two ground cars going the same way, side by side within 2 m.
    for (const [g, seed] of [
      [line, 3],
      [line, 8],
      [ring, 5],
      [ring, 9],
    ] as const) {
      const t = createTraffic(g, 200, seed);
      let nearest = Infinity;
      let moved = 0;
      run(t, 30, () => {
        for (let i = 0; i < t.count; i++) {
          if (t.air[i]) continue;
          for (let j = i + 1; j < t.count; j++) {
            if (t.air[j] || Math.cos(t.heading[i] - t.heading[j]) < 0.99) continue;
            const dx = t.x[j] - t.x[i];
            const dz = t.z[j] - t.z[i];
            const side = dx * Math.cos(t.heading[i]) - dz * Math.sin(t.heading[i]);
            if (Math.abs(side) < 2) nearest = Math.min(nearest, Math.hypot(dx, dz));
          }
        }
      });
      for (let i = 0; i < t.count; i++) moved += Math.abs(t.x[i]) + Math.abs(t.z[i]);
      expect(moved).toBeGreaterThan(0);
      expect(nearest).toBeGreaterThanOrEqual(MIN_GAP - 0.5);
    }
  });

  it("flying cars stay over highways at their lanes", () => {
    const t = createTraffic(ring, 200, 5);
    const flying = Array.from(t.air.keys()).filter((i) => t.air[i]);
    expect(flying.length).toBe(Math.floor(t.count * AIR_SHARE));
    run(t, 20, () => {
      for (const i of flying) {
        expect(AIR_LANES).toContain(t.y[i]);
        expect(toRing(t.x[i], t.z[i])).toBeLessThanOrEqual(roadHalf(ROAD.highway) + 1e-3);
      }
    });
    expect(new Set(flying.map((i) => t.y[i]))).toEqual(new Set(AIR_LANES));
  });

  it("ground cars ride right of the axis", () => {
    const t = createTraffic(line, 200, 7);
    const seen = new Set<number>();
    run(t, 20, () => {
      for (let i = 0; i < t.count; i++) {
        if (t.air[i]) continue;
        const x = t.x[i];
        const right = Math.sign(Math.sin(t.heading[i])); // +1 east: right is +z
        const d = Math.abs(t.z[i]);
        expect(t.z[i] * right).toBeGreaterThan(0);
        if (x > 15 && x < 985) {
          seen.add(d);
          expect([2, 6].some((o) => Math.abs(d - o) < 1e-3)).toBe(true);
        } else if (x > 1015 && x < 1985) {
          expect(d).toBeCloseTo(laneOffset(ROAD.street, 0), 3);
        }
      }
    });
    expect([...seen].map((d) => Math.round(d)).sort()).toEqual([2, 6]);
  });

  it("no cars on lanes", () => {
    const lanesOnly = graphOf([0, 0, 100, 0], [[0, 1, ROAD.lane]]);
    expect(createTraffic(lanesOnly, 50, 1).count).toBe(0);
    expect(createTraffic(graphOf([], []), 50, 1).count).toBe(0);

    // Streets east-west through the centre, lanes north-south: no car leaves the street axis.
    const cross = graphOf(
      [0, 0, 400, 0, -400, 0, 0, 400, 0, -400],
      [
        [0, 1, ROAD.street],
        [0, 2, ROAD.street],
        [0, 3, ROAD.lane],
        [0, 4, ROAD.lane],
      ],
    );
    const t = createTraffic(cross, 20, 2);
    expect(t.count).toBe(20);
    run(t, 30, () => {
      for (let i = 0; i < t.count; i++) expect(Math.abs(t.z[i])).toBeCloseTo(1.5, 3);
    });
  });

  it("a small city takes fewer cars", () => {
    const loop = graphOf(
      [0, 0, 400, 0, 400, 400, 0, 400],
      [
        [0, 1, ROAD.highway],
        [1, 2, ROAD.highway],
        [2, 3, ROAD.highway],
        [3, 0, ROAD.highway],
      ],
    );
    expect(createTraffic(loop, 500, 1).count).toBe(Math.floor((1600 * 4) / CAR_SPACING));
    expect(createTraffic(loop, 10, 1).count).toBe(10);
  });

  it("positions are finite", () => {
    for (const g of [line, ring]) {
      const t = createTraffic(g, 200, 11);
      run(t, 20);
      t.update(10); // a long frame after the tab was hidden
      for (const a of [t.x, t.y, t.z, t.heading]) {
        expect(Array.from(a).every(Number.isFinite)).toBe(true);
      }
    }
  });
});

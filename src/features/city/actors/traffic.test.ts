import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { BRIDGE_RISE } from "../world/map";
import { buildRoads, roadHalf } from "../world/roads";
import { AIR_LANES, AIR_SHARE, CAR_SPACING, createTraffic, type Traffic } from "./traffic";
import { laneOffset, MIN_GAP } from "./junctions";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
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
    // Two cars on their lanes (here the roads run along the axes) keep the gap of the rules. A car
    // drawn on the curve through a node cuts the corner: it can pass beside a car standing at the
    // node in the next lane, half a lane apart rather than one behind the other, or across the
    // lane of one going straight on, which the rules do not space it from. Those two only keep
    // their bodies apart (a car is 1.8 m wide and 4.2 m long, see `render/cars.ts`).
    const onLane = (h: number) => Math.abs(Math.sin(2 * h)) < 1e-3;
    const [WIDE, LONG] = [1.8, 4.2];
    for (const [g, seed] of [
      [line, 3],
      [line, 8],
      [ring, 5],
      [ring, 9],
    ] as const) {
      const t = createTraffic(g, 200, seed);
      let nearest = Infinity;
      let touching = 0;
      let moved = 0;
      run(t, 30, () => {
        for (let i = 0; i < t.count; i++) {
          if (t.air[i]) continue;
          for (let j = i + 1; j < t.count; j++) {
            if (t.air[j] || Math.cos(t.heading[i] - t.heading[j]) < 0.99) continue;
            const dx = t.x[j] - t.x[i];
            const dz = t.z[j] - t.z[i];
            const side = dx * Math.cos(t.heading[i]) - dz * Math.sin(t.heading[i]);
            if (Math.abs(side) >= 2) continue;
            if (onLane(t.heading[i]) && onLane(t.heading[j])) {
              nearest = Math.min(nearest, Math.hypot(dx, dz));
            } else {
              const along = dx * Math.sin(t.heading[i]) + dz * Math.cos(t.heading[i]);
              if (Math.abs(side) < WIDE && Math.abs(along) < LONG) touching++;
            }
          }
        }
      });
      for (let i = 0; i < t.count; i++) moved += Math.abs(t.x[i]) + Math.abs(t.z[i]);
      expect(moved).toBeGreaterThan(0);
      expect(nearest).toBeGreaterThanOrEqual(MIN_GAP - 0.5);
      expect(touching).toBe(0);
    }
  }, 20_000);

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
          seen.add(Math.round(d * 1000) / 1000);
          // On one of the two lanes, or drawn moving across between them.
          expect(d).toBeGreaterThan(2 - 1e-3);
          expect(d).toBeLessThan(6 + 1e-3);
        } else if (x > 1015 && x < 1985) {
          expect(d).toBeCloseTo(laneOffset(ROAD.street, 0), 3);
        }
      }
    });
    expect(seen.has(2) && seen.has(6)).toBe(true);
  });

  it("no cars on lanes", () => {
    const lanesOnly = graphOf([0, 0, 100, 0], [[0, 1, ROAD.lane]]);
    expect(createTraffic(lanesOnly, 50, 1).count).toBe(0);
    expect(createTraffic(graphOf([], []), 50, 1).count).toBe(0);

    // Streets east-west through the centre, lanes north-south: no car leaves the street (it
    // turns back at the dead ends across it).
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
      for (let i = 0; i < t.count; i++) expect(Math.abs(t.z[i])).toBeLessThan(1.5 + 1e-3);
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

  it("ground cars ride on the deck of a bridge", () => {
    // A highway east to x = 1000, then a street on a bridge to x = 2000.
    const bridged = buildRoads(
      mapOf([], {
        nodes: new Float32Array([0, 0, 1000, 0, 2000, 0]),
        edges: [
          { a: 0, b: 1, cls: ROAD.highway, bridge: false, liftA: 0, liftB: 0 },
          { a: 1, b: 2, cls: ROAD.street, bridge: true, liftA: BRIDGE_RISE, liftB: BRIDGE_RISE },
        ],
      }),
    );
    const t = createTraffic(bridged, 60, 5);
    let on = 0;
    let off = 0;
    const check = () => {
      for (let i = 0; i < t.count; i++) {
        if (t.air[i] || Math.abs(t.x[i] - 1000) < 1) continue; // flying, or at the node
        if (t.x[i] > 1000) {
          expect(t.y[i]).toBe(BRIDGE_RISE);
          on++;
        } else {
          expect(t.y[i]).toBe(0);
          off++;
        }
      }
    };
    check();
    run(t, 20, check);
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
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

import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { MIN_GAP } from "./junctions";
import { FADE, type Circle } from "./locals";
import { CAR_SPACING, createTraffic, type Traffic } from "./traffic";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

const run = (t: Traffic, seconds: number) => {
  for (let n = 0; n < seconds * 60; n++) t.update(1 / 60);
};

// A 4 x 4 grid of streets 150 m apart, the second row a highway, so roads of two lanes meet
// roads of one at its nodes.
function grid() {
  const nodes: number[] = [];
  const edges: [number, number, RoadKind][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) nodes.push(c * 150, r * 150);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const at = r * 4 + c;
      if (c < 3) edges.push([at, at + 1, r === 1 ? ROAD.highway : ROAD.street]);
      if (r < 3) edges.push([at, at + 4, ROAD.street]);
    }
  }
  return graphOf(nodes, edges);
}

/** The longest any ground car on the roads stood still, seconds, over `seconds` of driving. */
function longestStill(t: Traffic, seconds: number, around: Circle | null = null): number {
  const still = new Float32Array(t.count);
  const was = { x: Float32Array.from(t.x), z: Float32Array.from(t.z) };
  let longest = 0;
  for (let n = 0; n < seconds * 30; n++) {
    t.update(1 / 30, around);
    for (let i = 0; i < t.count; i++) {
      if (t.air[i] || (t as { live?: Uint8Array }).live?.[i] === 0) continue;
      const moved = Math.hypot(t.x[i] - was.x[i], t.z[i] - was.z[i]);
      still[i] = moved < 1e-3 ? still[i] + 1 / 30 : 0;
      longest = Math.max(longest, still[i]);
    }
    was.x.set(t.x);
    was.z.set(t.z);
  }
  return longest;
}

// The long runs, for a change to the right of way: CITY_SOAK=1 npm test -- traffic
const soak = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process
  ?.env.CITY_SOAK;
// The smallest circle of the locals, over the grid's middle block: its nodes lie in its ring.
const tight = { x: 225, z: 225, r: 150 };

describe("busy junctions", () => {
  it("no car stands still for more than 10 s on a full grid", () => {
    for (const seed of [1, 2, 3]) {
      expect(
        longestStill(createTraffic(grid(), 1000, seed), 60),
        `seed ${seed}`,
      ).toBeLessThanOrEqual(10);
    }
  }, 20_000);

  it("no car stands still for more than 10 s with every car kept near the camera", () => {
    for (const seed of [1, 2, 3]) {
      const t = createTraffic(grid(), 200, seed);
      expect(longestStill(t, 300, tight), `seed ${seed}`).toBeLessThanOrEqual(10);
    }
  }, 20_000);

  it.runIf(soak)(
    "no car stands still for more than 10 s over long runs",
    () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        expect(
          longestStill(createTraffic(grid(), 1000, seed), 600),
          `seed ${seed}`,
        ).toBeLessThanOrEqual(10);
        expect(
          longestStill(createTraffic(grid(), 200, seed), 600, tight),
          `seed ${seed}, near`,
        ).toBeLessThanOrEqual(10);
      }
    },
    600_000,
  );
});

describe("cars near the camera", () => {
  // A street 5 km east: one lane each way.
  const road = graphOf([0, 0, 5000, 0], [[0, 1, ROAD.street]]);
  const onRoads = (t: Traffic) => t.live.reduce((n, v) => n + v, 0);

  it("are no more than the roads of the circle hold; the rest wait off the roads", () => {
    const t = createTraffic(road, 40, 4);
    expect(t.air.every((a) => a === 0)).toBe(true);
    // 300 m of street in the circle, two lanes: room for 20 cars at CAR_SPACING.
    const near = { x: 2500, z: 0, r: 150 };
    for (let n = 0; n < 60; n++) t.update(1 / 30, near);
    expect(onRoads(t)).toBe((2 * 300) / CAR_SPACING);
    // Put down a car's length and more apart on a lane.
    const lanesOf = new Map<number, number[]>();
    for (let i = 0; i < t.count; i++) {
      if (!t.live[i]) continue;
      const key = Math.sign(Math.sin(t.heading[i]));
      lanesOf.set(key, [...(lanesOf.get(key) ?? []), t.x[i]]);
    }
    for (const xs of lanesOf.values()) {
      xs.sort((a, b) => a - b);
      for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThan(MIN_GAP);
    }
    // A wider circle takes them all back.
    for (let n = 0; n < 60; n++) t.update(1 / 30, { ...near, r: 600 });
    expect(onRoads(t)).toBe(t.count);
  });
});

describe("cars leaving the roads", () => {
  const road = graphOf([0, 0, 5000, 0], [[0, 1, ROAD.street]]);

  it("shrink away first as the view closes in", () => {
    const t = createTraffic(road, 40, 6);
    const wide = { x: 2500, z: 0, r: 600 };
    for (let n = 0; n < 60; n++) t.update(1 / 30, wide);
    expect(t.live.every((v) => v === 1)).toBe(true);
    // Three times closer: room for 400 m · 2 lanes / CAR_SPACING cars.
    const close = { ...wide, r: 200 };
    let left = 0;
    for (let n = 0; n < 45; n++) {
      const seen = Float32Array.from(t.appear);
      const was = Uint8Array.from(t.live);
      t.update(1 / 30, close);
      for (let i = 0; i < t.count; i++) {
        if (!was[i] || t.live[i]) continue;
        left++;
        // All but gone the frame before (the view of the wide circle is still around it).
        expect(seen[i]).toBeLessThanOrEqual(1 / 30 / FADE + 1e-6);
      }
    }
    expect(left).toBeGreaterThan(0);
    expect(t.live.reduce((n, v) => n + v, 0)).toBe(Math.floor((2 * 400) / CAR_SPACING));
  });
});

describe("a lane change at a node", () => {
  // A highway east to a node, on from it a highway east and a street north.
  const fork = graphOf(
    [0, 0, 300, 0, 600, 0, 300, 300],
    [
      [0, 1, ROAD.highway],
      [1, 2, ROAD.highway],
      [1, 3, ROAD.street],
    ],
  );

  it("is given up when the cars side by side want each other's lane", () => {
    // Side by side near the node, both preferring the outer lane, one still in the inner one:
    // whenever the inner one goes on by the highway and the outer by the street, each wants the
    // other's lane.
    for (let seed = 1; seed <= 12; seed++) {
      const t = createTraffic(fork, 2, seed, [
        { edge: 0, s: 296, forward: true, lane: 0, want: 1 },
        { edge: 0, s: 296, forward: true, lane: 1, want: 1 },
      ]);
      run(t, 5);
      for (let i = 0; i < 2; i++) {
        expect(t.x[i] > 305 || t.z[i] > 10, `seed ${seed}, car ${i}`).toBe(true);
      }
    }
  });
});

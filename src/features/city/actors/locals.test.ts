import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads, pointOn } from "../world/roads";
import {
  APPEAR,
  createLocals,
  localRadius,
  placeOn,
  RECHECK,
  ringSpots,
  type Circle,
  type Spots,
} from "./locals";
import { rng, type Allow, type Track } from "./nav";
import { createResidents, WALK, WALK_SPREAD } from "./residents";
import { MIN_GAP } from "./junctions";
import { createTraffic, SPEED } from "./traffic";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

const trackAt = (edge: number, s: number): Track => ({
  edge: Int32Array.of(edge),
  s: Float32Array.of(s),
  forward: Uint8Array.of(1),
});

describe("localRadius", () => {
  it("is 0.8 of the camera distance, between 150 m and 2 km", () => {
    expect([50, 500, 1000, 5000].map(localRadius)).toEqual([150, 400, 800, 2000]);
  });
});

describe("ringSpots", () => {
  // A road through the centre of the circle, one that only grazes its ring and one far off.
  const g = graphOf(
    [-1000, 0, 1000, 0, -1000, 80, 1000, 80, -1000, 500, 1000, 500],
    [
      [0, 1, ROAD.street],
      [2, 3, ROAD.street],
      [4, 5, ROAD.street],
    ],
  );
  const c = { x: 0, z: 0, r: 100 };
  const near = (got: number[], want: number[]) => {
    expect(got.length).toBe(want.length);
    got.forEach((v, k) => expect(v).toBeCloseTo(want[k], 3));
  };
  const half = Math.sqrt(90 ** 2 - 80 ** 2);

  it("are the stretches 0.6 r … 0.9 r from the centre", () => {
    const spots = ringSpots(g, c);
    expect(spots.edge).toEqual([0, 0, 1]);
    near(spots.s0, [910, 1060, 1000 - half]);
    near(spots.s1, [940, 1090, 1000 + half]);
    near(spots.end, [30, 60, 60 + 2 * half]);
  });

  it("are the whole circle from 0 on", () => {
    const spots = ringSpots(g, c, undefined, 0);
    expect(spots.edge).toEqual([0, 1]);
    near(spots.s0, [910, 1000 - half]);
    near(spots.s1, [1090, 1000 + half]);
  });

  it("put a mover in the ring, either way, or leave it where there are none", () => {
    const spots = ringSpots(g, c);
    const t = trackAt(2, 7);
    const rand = rng(4);
    const ways = new Set<number>();
    for (let n = 0; n < 50; n++) {
      expect(placeOn(g, t, 0, spots, rand)).toBe(true);
      const p = pointOn(g, t.edge[0], t.s[0], t.forward[0] === 1, 0);
      const d = Math.hypot(p.x, p.z);
      expect(d).toBeGreaterThanOrEqual(60 - 1e-3);
      expect(d).toBeLessThanOrEqual(90 + 1e-3);
      ways.add(t.forward[0]);
    }
    expect(ways.size).toBe(2);
    const none = ringSpots(g, { x: 0, z: 5000, r: 100 });
    const kept = trackAt(2, 7);
    expect(placeOn(g, kept, 0, none, rand)).toBe(false);
    expect([kept.edge[0], kept.s[0]]).toEqual([2, 7]);
  });
});

describe("createLocals", () => {
  it("scans the edges for its spots only when the circle moves", () => {
    const g = graphOf([0, 0, 5000, 0], [[0, 1, ROAD.street]]);
    let scanned = 0;
    const counting = () => (scanned++, true);
    const locals = createLocals(g, 4, [0, 1, 2, 3], rng(1));
    const at = { x: [4000, 4000, 4000, 4000], z: [0, 0, 0, 0] };
    // Nowhere to go: the strays stay strays and ask for spots at every look.
    const move = (_: number, spots: (allow: Allow) => Spots) => {
      spots(counting);
      return false;
    };
    const step = (x: number, r = 1000) => {
      scanned = 0;
      locals.update(RECHECK, { x, z: 50_000, r }, at, move);
      return scanned;
    };
    expect(step(0)).toBe(1); // the first look: the whole circle, one edge once
    expect(step(0)).toBe(1); // then the ring
    expect(step(0)).toBe(0);
    expect(step(40)).toBe(0); // within 5 % of r
    expect(step(60)).toBe(1);
    expect(step(60, 1100)).toBe(1);
  });
});

describe("the locals", () => {
  // A straight street 5 km east.
  const road = graphOf([0, 0, 5000, 0], [[0, 1, ROAD.street]]);
  type Crowd = { count: number; x: Float32Array; z: Float32Array; appear: Float32Array };
  const dist = (crowd: Crowd, i: number, c: Circle) =>
    Math.hypot(crowd.x[i] - c.x, crowd.z[i] - c.z);
  const all = (crowd: Crowd) => Array.from({ length: crowd.count }, (_, i) => i);
  // A local strays for at most one look, `RECHECK` seconds, before it is moved back.
  const reach = (c: Circle, speed: number) => c.r + speed * RECHECK + 5;
  const crowds = (seed: number) => ({
    cars: createTraffic(road, 40, seed),
    people: createResidents(road, 60, seed),
  });
  const run = (crowd: ReturnType<typeof crowds>, c: Circle, seconds: number, each?: () => void) => {
    for (let n = 0; n < seconds * 30; n++) {
      crowd.cars.update(1 / 30, c);
      crowd.people.update(1 / 30, c);
      each?.();
    }
  };
  const inside = (crowd: ReturnType<typeof crowds>, c: Circle) => {
    for (const i of all(crowd.cars)) {
      expect(dist(crowd.cars, i, c)).toBeLessThanOrEqual(reach(c, SPEED.street));
    }
    for (const i of all(crowd.people)) {
      expect(dist(crowd.people, i, c)).toBeLessThanOrEqual(reach(c, WALK + WALK_SPREAD));
    }
  };

  it("all gather near the target, the cars keeping their gaps", () => {
    const crowd = crowds(7);
    const around = { x: 0, z: 0, r: localRadius(1000) };
    let nearest = Infinity;
    run(crowd, around, 20, () => {
      const { cars } = crowd;
      // Every two cars going the same way: one street, so one lane each way.
      for (let i = 0; i < cars.count; i++) {
        for (let j = i + 1; j < cars.count; j++) {
          if (Math.cos(cars.heading[i] - cars.heading[j]) < 0.99) continue;
          nearest = Math.min(nearest, Math.hypot(cars.x[j] - cars.x[i], cars.z[j] - cars.z[i]));
        }
      }
    });
    expect(crowd.cars.count).toBe(40);
    // Exact but for the float32 positions, some 5 km from the origin.
    expect(nearest).toBeGreaterThanOrEqual(MIN_GAP - 0.01);
    inside(crowd, around);
  });

  it("fill the whole circle at once where the view jumped", () => {
    const crowd = crowds(5);
    run(crowd, { x: 0, z: 0, r: 800 }, 2);
    const there = { x: 3000, z: 0, r: 800 };
    run(crowd, there, 1);
    inside(crowd, there);
    for (const c of [crowd.cars, crowd.people]) {
      const middle = all(c).filter((i) => dist(c, i, there) < 0.5 * there.r).length;
      expect(middle).toBeGreaterThanOrEqual(c.count / 3);
    }
  });

  it("spread out evenly as the view backs off", () => {
    const crowd = crowds(9);
    const close = { x: 2500, z: 0, r: 400 };
    run(crowd, close, 2);
    const far = { ...close, r: 1200 };
    run(crowd, far, 1);
    for (const c of [crowd.cars, crowd.people]) {
      const rim = all(c).filter((i) => dist(c, i, close) > close.r && dist(c, i, far) <= far.r);
      expect(rim.length).toBeGreaterThanOrEqual(0.6 * c.count);
    }
  });

  it("grow in over half a second where they are put", () => {
    const around = { x: 0, z: 0, r: localRadius(1000) };
    for (const crowd of [createTraffic(road, 40, 3), createResidents(road, 60, 3)]) {
      expect(Array.from(crowd.appear).every((a) => a === 1)).toBe(true);
      crowd.update(RECHECK, around);
      const moved = all(crowd).filter((i) => crowd.appear[i] === 0);
      expect(moved.length).toBeGreaterThan(0);
      // The first look fills the circle.
      for (const i of moved) expect(dist(crowd, i, around)).toBeLessThanOrEqual(around.r);
      // One well inside it, so that no look moves it again.
      const i = moved.find((k) => dist(crowd, k, around) < around.r - 50)!;
      crowd.update(APPEAR / 2, around);
      expect(crowd.appear[i]).toBeCloseTo(0.5, 5);
      crowd.update(APPEAR / 2, around);
      expect(crowd.appear[i]).toBe(1);
    }
  });
});

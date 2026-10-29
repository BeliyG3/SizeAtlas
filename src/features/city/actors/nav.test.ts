import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads, pointOn } from "../world/roads";
import {
  advance,
  createLocals,
  type Allow,
  type Spots,
  APPEAR,
  LOCAL_SHARE,
  localRadius,
  nextEdge,
  place,
  placeOn,
  RECHECK,
  ringSpots,
  rng,
  type Track,
} from "./nav";
import { createResidents, WALK, WALK_SPREAD } from "./residents";
import { createTraffic, MIN_GAP, SPEED } from "./traffic";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

function trackAt(edge: number, s: number, forward: boolean): Track {
  return {
    edge: Int32Array.of(edge),
    s: Float32Array.of(s),
    forward: Uint8Array.of(forward ? 1 : 0),
  };
}

// Node 0 is the centre; edges 0..3 run to nodes 1..4 (east, north, west, south), 10 m each.
// Edges 0 and 2 are streets, 1 and 3 lanes.
const cross = graphOf(
  [0, 0, 10, 0, 0, 10, -10, 0, 0, -10],
  [
    [0, 1, ROAD.street],
    [0, 2, ROAD.lane],
    [0, 3, ROAD.street],
    [0, 4, ROAD.lane],
  ],
);

// A chain 0-1-2-3 of 3, 4 and 5 m with a dead end at node 3.
const chain = graphOf(
  [0, 0, 3, 0, 7, 0, 12, 0],
  [
    [0, 1, ROAD.street],
    [1, 2, ROAD.street],
    [2, 3, ROAD.street],
  ],
);

describe("advance", () => {
  it("walks the edge and turns at a node without going back", () => {
    const t = trackAt(0, 5, false); // 5 m from node 1, heading to the centre
    advance(cross, t, 0, 3, rng(1));
    expect([t.edge[0], t.s[0], t.forward[0]]).toEqual([0, 8, 0]);
    advance(cross, t, 0, 4, rng(1)); // 2 m left on the edge, then 2 m on another one
    expect(t.edge[0]).not.toBe(0);
    expect(t.s[0]).toBe(2);
    expect(t.forward[0]).toBe(1); // it left the centre, node a
  });

  it("a dead end turns back", () => {
    const t = trackAt(2, 4, true);
    advance(chain, t, 0, 3, rng(1));
    expect([t.edge[0], t.s[0], t.forward[0]]).toEqual([2, 2, 0]);
  });

  it("the distance is kept across nodes", () => {
    const t = trackAt(0, 0.5, true);
    advance(chain, t, 0, 10, rng(1)); // 2.5 + 4 on the first two, 3.5 on the third
    expect(t.edge[0]).toBe(2);
    expect(t.s[0]).toBeCloseTo(3.5, 6);
    expect(t.forward[0]).toBe(1);
  });

  it("the same seed gives the same walk", () => {
    const walk = (seed: number) => {
      const r = rng(seed);
      const t = trackAt(0, 0, true);
      const seen: number[] = [];
      for (let n = 0; n < 1000; n++) {
        advance(cross, t, 0, 7.3, r);
        seen.push(t.edge[0], t.s[0], t.forward[0]);
      }
      return seen;
    };
    expect(walk(7)).toEqual(walk(7));
    expect(new Set(walk(7).filter((_, k) => k % 3 === 0)).size).toBeGreaterThan(1);
  });

  it("allow keeps a mover off forbidden edges", () => {
    const streets = (e: { cls: RoadKind }) => e.cls === ROAD.street;
    const r = rng(3);
    const t = trackAt(0, 0, true);
    const used = new Set<number>();
    for (let n = 0; n < 1000; n++) {
      if (n % 10 === 0) place(cross, t, 0, r, streets);
      else advance(cross, t, 0, 6, r, streets);
      used.add(t.edge[0]);
    }
    expect([...used].sort()).toEqual([0, 2]);
  });
});

describe("nextEdge", () => {
  it("never picks the edge it came from while another exists", () => {
    const r = rng(5);
    for (let n = 0; n < 50; n++) expect(nextEdge(cross, 0, 1, r)).not.toBe(1);
    expect(nextEdge(chain, 3, 2, r)).toBe(2);
  });
});

describe("rng", () => {
  it("stays in [0, 1) and differs between seeds", () => {
    const a = rng(1);
    const b = rng(2);
    for (let n = 0; n < 1000; n++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(rng(1)()).not.toBe(b());
  });
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

  it("are the stretches 0.6 r … 0.9 r from the centre", () => {
    const spots = ringSpots(g, c);
    const half = Math.sqrt(90 ** 2 - 80 ** 2);
    expect(spots.edge).toEqual([0, 0, 1]);
    near(spots.s0, [910, 1060, 1000 - half]);
    near(spots.s1, [940, 1090, 1000 + half]);
    near(spots.end, [30, 60, 60 + 2 * half]);
  });

  it("put a mover in the ring, either way, or leave it where there are none", () => {
    const spots = ringSpots(g, c);
    const t = trackAt(2, 7, true);
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
    const kept = trackAt(2, 7, true);
    expect(placeOn(g, kept, 0, none, rand)).toBe(false);
    expect([kept.edge[0], kept.s[0]]).toEqual([2, 7]);
  });
});

describe("createLocals", () => {
  it("scans the edges for a ring only when its circle moves", () => {
    const g = graphOf([0, 0, 5000, 0], [[0, 1, ROAD.street]]);
    let scanned = 0;
    const counting = () => (scanned++, true);
    const locals = createLocals(g, 4, [0, 1, 2, 3]);
    const at = { x: [4000, 4000, 4000, 4000], z: [0, 0, 0, 0] };
    // Nowhere to go: the strays stay strays and ask for the ring at every look.
    const move = (_: number, spots: (allow: Allow) => Spots) => {
      spots(counting);
      return false;
    };
    const step = (x: number, r = 1000) => {
      scanned = 0;
      locals.update(RECHECK, { x, z: 50_000, r }, at, move);
      return scanned;
    };
    expect(step(0)).toBe(1); // one edge, once
    expect(step(0)).toBe(0);
    expect(step(40)).toBe(0); // within 5 % of r
    expect(step(60)).toBe(1);
    expect(step(60, 1100)).toBe(1);
  });
});

describe("the locals", () => {
  // A straight street 5 km east, the camera's target at its west end, the camera 1 km off.
  const road = graphOf([0, 0, 5000, 0], [[0, 1, ROAD.street]]);
  const around = { x: 0, z: 0, r: localRadius(1000) };
  const locals = (count: number) => Math.round(count * LOCAL_SHARE);
  const dist = (crowd: { x: Float32Array; z: Float32Array }, i: number) =>
    Math.hypot(crowd.x[i] - around.x, crowd.z[i] - around.z);
  const strays = (crowd: { count: number; x: Float32Array; z: Float32Array }, from: number) =>
    Array.from({ length: crowd.count - from }, (_, k) => from + k).filter(
      (i) => dist(crowd, i) > around.r,
    ).length;

  it("gather near the target while the others roam, the cars keeping their gaps", () => {
    const cars = createTraffic(road, 40, 7);
    const people = createResidents(road, 60, 7);
    expect(cars.count).toBe(40);
    let nearest = Infinity;
    for (let n = 0; n < 30 * 20; n++) {
      cars.update(1 / 30, around);
      people.update(1 / 30, around);
      // Every two cars going the same way: one street, so one lane each way.
      for (let i = 0; i < cars.count; i++) {
        for (let j = i + 1; j < cars.count; j++) {
          if (Math.cos(cars.heading[i] - cars.heading[j]) < 0.99) continue;
          nearest = Math.min(nearest, Math.hypot(cars.x[j] - cars.x[i], cars.z[j] - cars.z[i]));
        }
      }
    }
    // Exact but for the float32 positions, some 5 km from the origin.
    expect(nearest).toBeGreaterThanOrEqual(MIN_GAP - 0.01);
    // A local strays for at most one look, `RECHECK` seconds, before it is moved back.
    for (let i = 0; i < locals(cars.count); i++) {
      expect(dist(cars, i)).toBeLessThanOrEqual(around.r + SPEED.street * RECHECK + 2);
    }
    for (let i = 0; i < locals(people.count); i++) {
      expect(dist(people, i)).toBeLessThanOrEqual(around.r + (WALK + WALK_SPREAD) * RECHECK + 5);
    }
    expect(strays(cars, locals(cars.count))).toBeGreaterThan(0);
    expect(strays(people, locals(people.count))).toBeGreaterThan(0);
  });

  it("grow in over half a second where they are put", () => {
    for (const crowd of [createTraffic(road, 40, 3), createResidents(road, 60, 3)]) {
      expect(Array.from(crowd.appear).every((a) => a === 1)).toBe(true);
      crowd.update(RECHECK, around);
      const moved = Array.from(crowd.appear.keys()).filter((i) => crowd.appear[i] === 0);
      expect(moved.length).toBeGreaterThan(0);
      for (const i of moved) {
        expect(i).toBeLessThan(locals(crowd.count));
        expect(dist(crowd, i)).toBeGreaterThanOrEqual(0.6 * around.r - 5);
        expect(dist(crowd, i)).toBeLessThanOrEqual(around.r + 5);
      }
      // One well inside the circle, so that no look moves it again.
      const i = moved.find((k) => dist(crowd, k) < around.r - 50)!;
      crowd.update(APPEAR / 2, around);
      expect(crowd.appear[i]).toBeCloseTo(0.5, 5);
      crowd.update(APPEAR / 2, around);
      expect(crowd.appear[i]).toBe(1);
    }
  });
});

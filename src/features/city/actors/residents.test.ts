import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { BRIDGE_RISE } from "../world/map";
import { buildRoads } from "../world/roads";
import { rng } from "./nav";
import {
  NEAR,
  ROLE,
  STRIDE,
  WALK,
  WALK_SPREAD,
  createResidents,
  splitNear,
  walkOffset,
} from "./residents";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

// A street east along z = 0 to (1000, 0); from there a lane south to z = 300 and a highway north.
const town = graphOf(
  [0, 0, 1000, 0, 1000, 300, 1000, -500],
  [
    [0, 1, ROAD.street],
    [1, 2, ROAD.lane],
    [1, 3, ROAD.highway],
  ],
);

describe("walkOffset", () => {
  it("is the middle of the sidewalk on a street, 1.2 m on a lane and none elsewhere", () => {
    expect(walkOffset(ROAD.street)).toBe(4);
    expect(walkOffset(ROAD.lane)).toBe(1.2);
    expect([ROAD.highway, ROAD.ring, ROAD.ramp].map(walkOffset)).toEqual([0, 0, 0]);
  });
});

describe("residents", () => {
  it("walk on sidewalks and lanes, never on highways", () => {
    const r = createResidents(town, 60, 5);
    expect(r.count).toBe(60);
    for (let step = 0; step < 300; step++) {
      r.update(0.5);
      for (let i = 0; i < r.count; i++) {
        const x = r.x[i];
        const z = r.z[i];
        if (Math.hypot(x - 1000, z) < 6) continue; // near the node the sides may be crossing
        const onStreet = x < 1000 && Math.abs(Math.abs(z) - 4) < 1e-3;
        const onLane = z > 0 && Math.abs(Math.abs(x - 1000) - 1.2) < 1e-3;
        expect(onStreet || onLane).toBe(true);
      }
    }
  });

  it("keep the walk phase in 0…1, moving with the distance", () => {
    const r = createResidents(town, 20, 9);
    const dt = 0.5;
    for (let step = 0; step < 100; step++) {
      const before = Float32Array.from(r.phase);
      r.update(dt);
      for (let i = 0; i < r.count; i++) {
        expect(r.phase[i]).toBeGreaterThanOrEqual(0);
        expect(r.phase[i]).toBeLessThan(1);
        const gained = (r.phase[i] - before[i] + 1) % 1;
        expect(gained).toBeGreaterThan(((WALK - WALK_SPREAD) * dt) / STRIDE - 1e-3);
        expect(gained).toBeLessThan(((WALK + WALK_SPREAD) * dt) / STRIDE + 1e-3);
      }
    }
    const still = Float32Array.from(r.phase);
    r.update(0);
    expect(Array.from(r.phase)).toEqual(Array.from(still));
  });

  it("all start as residents", () => {
    const r = createResidents(town, 150, 1);
    expect(r.role.every((v) => v === ROLE.resident)).toBe(true);
  });

  it("walk on the deck of a bridge", () => {
    // A street east to x = 1000, then a street on a bridge to x = 2000.
    const bridged = buildRoads(
      mapOf([], {
        nodes: new Float32Array([0, 0, 1000, 0, 2000, 0]),
        edges: [
          { a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 },
          { a: 1, b: 2, cls: ROAD.street, bridge: true, liftA: BRIDGE_RISE, liftB: BRIDGE_RISE },
        ],
      }),
    );
    const r = createResidents(bridged, 60, 5);
    let on = 0;
    for (let step = 0; step < 100; step++) {
      r.update(0.5);
      for (let i = 0; i < r.count; i++) {
        if (Math.abs(r.x[i] - 1000) < 6) continue; // at the node
        expect(r.y[i]).toBe(r.x[i] > 1000 ? BRIDGE_RISE : 0);
        if (r.x[i] > 1000) on++;
      }
    }
    expect(on).toBeGreaterThan(0);
  });

  it("are none where no road is walkable", () => {
    const r = createResidents(graphOf([0, 0, 100, 0], [[0, 1, ROAD.highway]]), 10, 1);
    expect(r.count).toBe(0);
  });
});

describe("splitNear", () => {
  it("partitions every figure exactly once by distance", () => {
    const rand = rng(3);
    const count = 200;
    const x = Float32Array.from({ length: count }, () => rand() * 400 - 200);
    const y = Float32Array.from({ length: count }, () => rand() * 2);
    const z = Float32Array.from({ length: count }, () => rand() * 400 - 200);
    const out = { near: new Int32Array(count), far: new Int32Array(count) };
    const n = splitNear({ x, y, z }, count, { x: 10, y: 50, z: -20 }, NEAR, out);
    // In 3D: the camera's height counts.
    const dist = (i: number) => Math.hypot(x[i] - 10, y[i] - 50, z[i] + 20);
    expect(n.near + n.far).toBe(count);
    const seen = [...out.near.subarray(0, n.near), ...out.far.subarray(0, n.far)].sort(
      (a, b) => a - b,
    );
    expect(seen).toEqual(Array.from({ length: count }, (_, i) => i));
    for (const i of out.near.subarray(0, n.near)) expect(dist(i)).toBeLessThanOrEqual(NEAR);
    for (const i of out.far.subarray(0, n.far)) expect(dist(i)).toBeGreaterThan(NEAR);
    expect(n.near).toBeGreaterThan(0);
    expect(n.far).toBeGreaterThan(0);
  });
});

describe("join", () => {
  it("puts the farthest resident at the spot, who walks onto the sidewalk and on along it", () => {
    const r = createResidents(town, 20, 3);
    // In the street's middle, by a car's door: the sidewalk is 4 m to its side.
    const j = r.join(300, 1);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(r.x[j] - 300, r.z[j] - 1)).toBeLessThan(1e-3);
    // Facing the nearer sidewalk (z = 4), then on it.
    expect(r.heading[j]).toBeCloseTo(0);
    r.update(1);
    expect(r.z[j]).toBeGreaterThanOrEqual(1 + WALK - WALK_SPREAD - 1e-3);
    expect(r.z[j]).toBeLessThanOrEqual(1 + WALK + WALK_SPREAD + 1e-3);
    expect(r.x[j]).toBeCloseTo(300);
    for (let i = 0; i < 10; i++) r.update(0.5);
    expect(r.z[j]).toBeCloseTo(4);
    expect(Math.abs(r.x[j] - 300)).toBeGreaterThan(1);
  });

  it("is -1 where nobody walks", () => {
    const r = createResidents(graphOf([0, 0, 100, 0], [[0, 1, ROAD.highway]]), 5, 1);
    expect(r.join(50, 0)).toBe(-1);
  });
});

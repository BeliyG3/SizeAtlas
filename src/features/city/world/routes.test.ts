import { describe, expect, it } from "vitest";
import { laneOffset } from "../actors/junctions";
import { walkOffset, walks } from "../actors/residents";
import { drives } from "../actors/traffic";
import type { Allow } from "../actors/nav";
import { mergeIslands } from "./archipelago";
import { BRIDGE_RISE, POLY, ROAD, type RoadKind } from "./map";
import { mapOf, square } from "./map.fixture";
import { buildRoads, type RoadGraph } from "./roads";
import { buildRoutes, ROUTE_POINTS, ROUTE_STEP, type Routes } from "./routes";

/** An island 100 m square with a street east from (0, 0), a lane north, a gate at (50, 0). */
const island = (generation: number) =>
  mapOf([square(POLY.district, 1, 1, 10, 0, 0, 100)], {
    generation,
    nodes: new Float32Array([0, 0, 50, 0, 0, 40]),
    edges: [
      { a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 },
      { a: 0, b: 2, cls: ROAD.lane, bridge: false, liftA: 0, liftB: 0 },
    ],
    gates: [{ node: 1, dx: 1, dz: 0, neighbour: 0 }],
  });

// Two islands 1000 m apart, the gates joined by a bridge up over the sea and down again.
const archipelago = buildRoads(
  mergeIslands(
    [
      { map: island(1), x: 0, z: 0 },
      { map: island(2), x: 1000, z: 0 },
    ],
    [
      {
        a: [0, 1],
        b: [1, 1],
        points: [
          [50, 0],
          [300, 0],
          [800, 0],
          [1050, 0],
        ],
        levels: [0, 0, 0],
      },
    ],
  ),
);

const point = (r: Routes, route: number, k: number) => {
  const at = (route * ROUTE_POINTS + k) * 4;
  return Array.from(r.points.subarray(at, at + 4));
};

const steps = (r: Routes, route: number) => r.length[route] / ROUTE_STEP;

/** Distance in the plan from (x, z) to edge `e`, and the road's height at the nearest spot. */
function nearest(g: RoadGraph, e: number, x: number, z: number) {
  const { a, b, len, liftA, liftB } = g.edges[e];
  const [ax, az, bx, bz] = [g.nodes[a * 2], g.nodes[a * 2 + 1], g.nodes[b * 2], g.nodes[b * 2 + 1]];
  const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
  const d = Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t);
  return { d, y: liftA + (liftB - liftA) * t };
}

/**
 * Is every point of every route on an edge `allow` lets in, at the road's height there, with the
 * side offset `side` gives for that edge's class?
 */
function onEdges(g: RoadGraph, r: Routes, allow: Allow, side: (cls: RoadKind) => number) {
  for (let route = 0; route < r.count; route++) {
    for (let k = 0; k <= steps(r, route); k++) {
      const [x, y, z, w] = point(r, route, k);
      const hits = g.edges
        .map((e, i) => ({ ok: allow(e), w: side(e.cls), ...nearest(g, i, x, z) }))
        .filter((h) => h.ok && h.d < 1e-3);
      if (!hits.some((h) => Math.abs(h.y - y) < 1e-3 && Math.abs(h.w - w) < 1e-6)) return false;
    }
  }
  return true;
}

describe("buildRoutes", () => {
  const cars = buildRoutes(archipelago, "drive", 16, 7);
  const walkers = buildRoutes(archipelago, "walk", 16, 7);

  it("puts the points of a route 4 m apart, there and back to the start", () => {
    for (const r of [cars, walkers]) {
      expect(r.count).toBe(16);
      for (let route = 0; route < r.count; route++) {
        const n = steps(r, route);
        expect(Number.isInteger(n) && n > 0 && n < ROUTE_POINTS).toBe(true);
        expect(point(r, route, n)).toEqual(point(r, route, 0));
        if (n + 1 < ROUTE_POINTS) expect(point(r, route, n + 1)).toEqual([0, 0, 0, 0]);
        for (let k = 0; k < n; k++) {
          const [x0, , z0, w] = point(r, route, k);
          const [x1, , z1] = point(r, route, k + 1);
          expect(w).toBeGreaterThan(0);
          // In the plan, as the roads measure; a step that turns at a node is shorter in a line.
          const d = Math.hypot(x1 - x0, z1 - z0);
          expect(d).toBeLessThanOrEqual(ROUTE_STEP + 1e-3);
        }
      }
    }
  });

  it("keeps a whole straight stretch exactly 4 m a step", () => {
    // One straight street, 10 km long: nothing to turn at for the first 4 km either way.
    const road = buildRoads(
      mapOf([], {
        nodes: new Float32Array([0, 0, 10000, 0]),
        edges: [{ a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 }],
      }),
    );
    const r = buildRoutes(road, "drive", 4, 3);
    for (let route = 0; route < r.count; route++) {
      const n = steps(r, route);
      for (let k = 0; k < n; k++) {
        const [x0] = point(r, route, k);
        const [x1] = point(r, route, k + 1);
        // Not the step that turns round at an end.
        if (Math.min(x0, x1) >= ROUTE_STEP && Math.max(x0, x1) <= 10000 - ROUTE_STEP) {
          expect(Math.abs(Math.abs(x1 - x0) - ROUTE_STEP)).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("keeps cars and walkers to their own edges and sides, at the deck's height on a bridge", () => {
    expect(onEdges(archipelago, cars, drives, (cls) => laneOffset(cls, 0))).toBe(true);
    expect(onEdges(archipelago, walkers, walks, walkOffset)).toBe(true);
    // Cars cross the bridge, up off the ground.
    const high = Array.from({ length: cars.count }, (_, route) =>
      Array.from({ length: steps(cars, route) }, (_, k) => point(cars, route, k)[1]),
    ).flat();
    expect(Math.max(...high)).toBeGreaterThan(BRIDGE_RISE);
  });

  it("is the same for the same seed and another for another", () => {
    expect(buildRoutes(archipelago, "drive", 16, 7)).toEqual(cars);
    expect(buildRoutes(archipelago, "drive", 16, 8).points).not.toEqual(cars.points);
  });

  it("starts routes on both islands", () => {
    for (const r of [cars, walkers]) {
      const starts = Array.from({ length: r.count }, (_, route) => point(r, route, 0)[0]);
      expect(starts.some((x) => x <= 50)).toBe(true);
      expect(starts.some((x) => x >= 1000)).toBe(true);
    }
  });

  it("has no routes without roads for the kind", () => {
    const lanesOnly = buildRoads(
      mapOf([], {
        nodes: new Float32Array([0, 0, 100, 0]),
        edges: [{ a: 0, b: 1, cls: ROAD.lane as RoadKind, bridge: false, liftA: 0, liftB: 0 }],
      }),
    );
    expect(buildRoutes(lanesOnly, "drive", 8, 1).count).toBe(0);
    const walkers = buildRoutes(lanesOnly, "walk", 8, 1);
    expect(walkers.count).toBe(8);
    // On a lane a walker keeps to the lane's side, not to a street's sidewalk.
    expect(point(walkers, 0, 1)[3]).toBeCloseTo(walkOffset(ROAD.lane), 6);
  });

  it("leaves out a route shorter than a step", () => {
    const dot = (len: number) =>
      buildRoads(
        mapOf([], {
          nodes: new Float32Array([0, 0, len, 0]),
          edges: [{ a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 }],
        }),
      );
    expect(buildRoutes(dot(0), "drive", 8, 1).count).toBe(0);
    // A walk of a ten-thousandth of a metre an edge ends (at its cap of edges) within a step.
    const tiny = buildRoutes(dot(1e-4), "drive", 8, 1);
    expect([tiny.count, tiny.points.length, tiny.length.length]).toEqual([0, 0, 0]);
  });
});

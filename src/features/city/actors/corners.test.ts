import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads, pointOn, type RoadGraph } from "../world/roads";
import { CORNER, cornerAt } from "./corners";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

// East 100 m to the node at the origin, then 100 m toward +z: a right turn.
const corner = graphOf(
  [-100, 0, 0, 0, 0, 100],
  [
    [0, 1, ROAD.street],
    [1, 2, ROAD.street],
  ],
);
const OFF = 1.5;

type Way = [edge: number, forward: boolean];

/** The curve from `from` to `to` sampled every 5 cm, headings unwrapped. */
function sample(g: RoadGraph, [inE, inF]: Way, [outE, outF]: Way, off = OFF) {
  const pts: { x: number; z: number; heading: number }[] = [];
  for (let d = 0; d <= 2 * CORNER + 1e-9; d += 0.05) {
    const pose = { x: 0, z: 0, heading: 0 };
    expect(cornerAt(g, inE, inF, off, outE, outF, off, d, pose)).toBe(true);
    const prev = pts.at(-1);
    if (prev) {
      const turn = Math.atan2(
        Math.sin(pose.heading - prev.heading),
        Math.cos(pose.heading - prev.heading),
      );
      pose.heading = prev.heading + turn;
    }
    pts.push(pose);
  }
  return pts;
}

const length = (pts: { x: number; z: number }[]) =>
  pts.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.x - pts[k].x, p.z - pts[k].z), 0);

/** The curve starts and ends on its lanes, its heading turns smoothly one way only. */
function expectSmooth(
  pts: { x: number; z: number; heading: number }[],
  from: Way,
  to: Way,
  g = corner,
) {
  const p0 = pointOn(g, from[0], g.edges[from[0]].len - CORNER, from[1], OFF);
  const p2 = pointOn(g, to[0], CORNER, to[1], OFF);
  const [first, last] = [pts[0], pts.at(-1)!];
  expect(Math.hypot(first.x - p0.x, first.z - p0.z)).toBeLessThanOrEqual(0.01);
  expect(Math.hypot(last.x - p2.x, last.z - p2.z)).toBeLessThanOrEqual(0.01);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  expect(Math.abs(wrap(first.heading - p0.heading))).toBeLessThan(1e-3);
  expect(Math.abs(wrap(last.heading - p2.heading))).toBeLessThan(1e-3);
  const way = Math.sign(last.heading - first.heading);
  for (let k = 1; k < pts.length; k++) {
    const turn = pts[k].heading - pts[k - 1].heading;
    expect(Math.abs(turn)).toBeLessThan(0.05);
    expect(turn * way).toBeGreaterThanOrEqual(-1e-6);
  }
}

describe("cornerAt", () => {
  it("turns right through 90 degrees on a curve shorter than the way along the roads", () => {
    const pts = sample(corner, [0, true], [1, true]);
    expectSmooth(pts, [0, true], [1, true]);
    expect(pts.at(-1)!.heading - pts[0].heading).toBeCloseTo(-Math.PI / 2, 3);
    expect(length(pts)).toBeLessThan(2 * CORNER);
  });

  it("turns left through 90 degrees the other way round", () => {
    const pts = sample(corner, [1, false], [0, false]);
    expectSmooth(pts, [1, false], [0, false]);
    expect(pts.at(-1)!.heading - pts[0].heading).toBeCloseTo(Math.PI / 2, 3);
    expect(length(pts)).toBeLessThan(2 * CORNER);
  });

  it("draws no curve where the road runs nearly straight on", () => {
    const bend = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return graphOf(
        [-100, 0, 0, 0, 100 * Math.cos(a), 100 * Math.sin(a)],
        [
          [0, 1, ROAD.street],
          [1, 2, ROAD.street],
        ],
      );
    };
    const pose = { x: 7, z: 7, heading: 7 };
    expect(cornerAt(bend(3), 0, true, OFF, 1, true, OFF, 5, pose)).toBe(false);
    expect(pose).toEqual({ x: 7, z: 7, heading: 7 });
    // Just over the limit the curve keeps close to the straight line between its ends.
    const g = bend(6);
    const pts = sample(g, [0, true], [1, true]);
    expectSmooth(pts, [0, true], [1, true], g);
    const [a, b] = [pts[0], pts.at(-1)!];
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    for (const p of pts) {
      const off = ((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / chord;
      expect(Math.abs(off)).toBeLessThan(0.3);
    }
  });

  it("turns back at a dead end without a loop", () => {
    const pts = sample(corner, [0, true], [0, false]);
    expectSmooth(pts, [0, true], [0, false]);
    expect(Math.abs(pts.at(-1)!.heading - pts[0].heading)).toBeCloseTo(Math.PI, 3);
    // No two pieces of the curve cross.
    const crosses = (
      p: (typeof pts)[0],
      q: (typeof pts)[0],
      r: (typeof pts)[0],
      s: (typeof pts)[0],
    ) => {
      const side = (a: typeof p, b: typeof p, c: typeof p) =>
        Math.sign((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      return side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;
    };
    for (let i = 1; i < pts.length; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        expect(crosses(pts[i - 1], pts[i], pts[j - 1], pts[j])).toBe(false);
      }
    }
  });
});

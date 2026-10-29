import { describe, expect, it } from "vitest";
import { BRIDGE_RISE, ROAD, ROAD_WIDTH } from "./map";
import { mapOf } from "./map.fixture";
import { buildRoads, pointOn, roadHalf } from "./roads";

// Node 0 (0, 0), 1 (10, 0), 2 (10, 10), 3 (20, 20): a way east, then north-south, then diagonal.
const map = mapOf([], {
  nodes: new Float32Array([0, 0, 10, 0, 10, 10, 20, 20]),
  edges: [
    { a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 },
    { a: 1, b: 2, cls: ROAD.highway, bridge: false, liftA: 0, liftB: 0 },
    { a: 2, b: 3, cls: ROAD.lane, bridge: true, liftA: BRIDGE_RISE, liftB: BRIDGE_RISE },
  ],
});

describe("buildRoads", () => {
  it("links list the edges of each node", () => {
    const g = buildRoads(map);
    expect(g.links).toEqual([[0], [0, 1], [1, 2], [2]]);
    expect(g.edges.map((e) => e.len)).toEqual([10, 10, Math.hypot(10, 10)]);
    expect(g.edges[2]).toMatchObject({
      a: 2,
      b: 3,
      cls: ROAD.lane,
      bridge: true,
      liftA: BRIDGE_RISE,
      liftB: BRIDGE_RISE,
    });
  });

  it("roadHalf is half the road's width", () => {
    expect(roadHalf(ROAD.highway)).toBe(ROAD_WIDTH[ROAD.highway] / 2);
    expect(roadHalf(ROAD.lane)).toBe(2.5);
  });
});

describe("pointOn", () => {
  const g = buildRoads(map);

  it("keeps right of the way", () => {
    const fwd = pointOn(g, 0, 4, true, 3);
    expect(fwd.x).toBeCloseTo(4);
    expect(fwd.z).toBeCloseTo(3);
    expect(fwd.heading).toBeCloseTo(Math.PI / 2);
    // Going back from the far end: 4 m on is at x = 6, and right is now -z.
    const back = pointOn(g, 0, 4, false, 3);
    expect(back.x).toBeCloseTo(6);
    expect(back.z).toBeCloseTo(-3);
    expect(back.heading).toBeCloseTo(-Math.PI / 2);
  });

  it("follows a diagonal edge", () => {
    const p = pointOn(g, 2, Math.SQRT2 * 2, true, Math.SQRT2);
    // Along (1, 1)/√2 from (10, 10); right of it is (-1, 1)/√2.
    expect(p.x).toBeCloseTo(10 + 2 - 1);
    expect(p.z).toBeCloseTo(10 + 2 + 1);
    expect(p.heading).toBeCloseTo(Math.PI / 4);
  });
});

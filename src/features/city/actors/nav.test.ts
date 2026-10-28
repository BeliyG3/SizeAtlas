import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { advance, nextEdge, place, rng, type Track } from "./nav";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false })),
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

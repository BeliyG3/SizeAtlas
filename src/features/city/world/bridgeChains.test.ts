import { describe, expect, it } from "vitest";
import type { ArchipelagoBridge } from "../../../api/types";
import { BRIDGE_RISE } from "./map";
import { bridgeChains, deckLift } from "./bridgeChains";

type Pt = [number, number];

const bridge = (points: Pt[], level = 0): ArchipelagoBridge => ({
  a: [0, 0],
  b: [0, 0],
  points,
  level,
});

/** The new nodes as `[x, z]` pairs. */
const spots = (nodes: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < nodes.length; i += 2) out.push([nodes[i], nodes[i + 1]]);
  return out;
};

/** The lifts of the edges that run from node `a` to node `b`, whichever way they are stored. */
const lifts = (
  edges: { a: number; b: number; liftA: number; liftB: number }[],
  a: number,
  b: number,
) =>
  edges
    .filter((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    .map((e) => (e.a === a ? [e.liftA, e.liftB] : [e.liftB, e.liftA]));

// Gates are nodes 1, 3 and 5 of the merged map; the new nodes are numbered from 6.
const FIRST = 6;

describe("deckLift", () => {
  it("is 8 m on the first level and 5 m higher on each next", () => {
    expect(deckLift(0)).toBe(8);
    expect(deckLift(2)).toBe(18);
  });
});

describe("bridgeChains", () => {
  it("rises on the first straight, stays level, falls on the last", () => {
    const { nodes, edges } = bridgeChains(
      [
        bridge([
          [50, 0],
          [300, 0],
          [800, 0],
          [1050, 0],
        ]),
      ],
      [[1, 3]],
      FIRST,
      0,
      0,
    );
    expect(spots(nodes)).toEqual([
      [300, 0],
      [800, 0],
    ]);
    expect(edges.map((e) => [e.a, e.b, e.liftA, e.liftB])).toEqual([
      [1, 6, BRIDGE_RISE, 8],
      [6, 7, 8, 8],
      [7, 3, 8, BRIDGE_RISE],
    ]);
  });

  it("shifts the points by (dx, dz)", () => {
    const { nodes } = bridgeChains(
      [
        bridge([
          [0, 0],
          [10, 0],
          [10, 9],
          [0, 9],
        ]),
      ],
      [[1, 3]],
      FIRST,
      5,
      -2,
    );
    expect(spots(nodes)).toEqual([
      [15, -2],
      [15, 7],
    ]);
  });

  it("gives a bridge of one straight run a node in its middle to rise to and fall from", () => {
    const { nodes, edges } = bridgeChains(
      [
        bridge(
          [
            [50, 0],
            [1050, 0],
          ],
          1,
        ),
      ],
      [[1, 3]],
      FIRST,
      0,
      0,
    );
    expect(spots(nodes)).toEqual([[550, 0]]);
    expect(edges.map((e) => [e.liftA, e.liftB])).toEqual([
      [BRIDGE_RISE, deckLift(1)],
      [deckLift(1), BRIDGE_RISE],
    ]);
  });

  it("makes bridges that leave a gate along the same points one run up to the fork", () => {
    const { nodes, edges } = bridgeChains(
      [
        bridge(
          [
            [50, 0],
            [300, 0],
            [1000, 0],
            [1050, 0],
          ],
          0,
        ),
        bridge(
          [
            [50, 0],
            [300, 0],
            [300, 1000],
            [50, 1000],
          ],
          1,
        ),
      ],
      [
        [1, 3],
        [1, 5],
      ],
      FIRST,
      0,
      0,
    );
    // The fork (300, 0), (1000, 0) and (300, 1000).
    expect(spots(nodes)).toEqual([
      [300, 0],
      [1000, 0],
      [300, 1000],
    ]);
    expect(edges).toHaveLength(5);
    // One edge leaves the gate, a ramp to the lower deck; each branch goes on to its own.
    expect(edges.filter((e) => e.a === 1 || e.b === 1)).toHaveLength(1);
    expect(lifts(edges, 1, 6)).toEqual([[BRIDGE_RISE, deckLift(0)]]);
    expect(lifts(edges, 6, 7)).toEqual([[deckLift(0), deckLift(0)]]);
    expect(lifts(edges, 6, 8)).toEqual([[deckLift(0), deckLift(1)]]);
    expect(lifts(edges, 8, 5)).toEqual([[deckLift(1), BRIDGE_RISE]]);
  });

  it("makes bridges that arrive at a gate along the same points one run too", () => {
    const { nodes, edges } = bridgeChains(
      [
        bridge(
          [
            [1050, 0],
            [900, 0],
            [300, 0],
            [50, 0],
          ],
          0,
        ),
        bridge(
          [
            [50, 1000],
            [300, 1000],
            [300, 0],
            [50, 0],
          ],
          1,
        ),
      ],
      [
        [3, 1],
        [5, 1],
      ],
      FIRST,
      0,
      0,
    );
    expect(spots(nodes)).toEqual([
      [900, 0],
      [300, 0],
      [300, 1000],
    ]);
    expect(edges).toHaveLength(5);
    expect(edges.filter((e) => e.a === 1 || e.b === 1)).toHaveLength(1);
    // The shared run falls from the lower deck to the gate; the branches come up to the fork.
    expect(lifts(edges, 7, 1)).toEqual([[deckLift(0), BRIDGE_RISE]]);
    expect(lifts(edges, 6, 7)).toEqual([[deckLift(0), deckLift(0)]]);
    expect(lifts(edges, 8, 7)).toEqual([[deckLift(1), deckLift(0)]]);
  });

  // Two bridges leave the gate (0, 0) east; the first runs end at 40 m and at 70 m.
  it.each([
    ["the shorter run on the higher deck", 0, 1],
    ["the shorter run on the lower deck", 1, 0],
  ])("splits the longer first run where the shorter ends: %s", (_, longLevel, shortLevel) => {
    const { nodes, edges } = bridgeChains(
      [
        bridge(
          [
            [0, 0],
            [70, 0],
            [70, 300],
            [500, 300],
          ],
          longLevel,
        ),
        bridge(
          [
            [0, 0],
            [40, 0],
            [40, -200],
            [500, -200],
          ],
          shortLevel,
        ),
      ],
      [
        [1, 3],
        [1, 5],
      ],
      FIRST,
      0,
      0,
    );
    // (40, 0) is one node on both; the others are the longer run's end and the corners beyond.
    expect(spots(nodes)).toEqual([
      [40, 0],
      [70, 0],
      [70, 300],
      [40, -200],
    ]);
    expect(edges).toHaveLength(6);
    const low = Math.min(deckLift(longLevel), deckLift(shortLevel));
    // The shared edge 0-40 m is the only one out of the gate and ramps to the lower deck.
    expect(edges.filter((e) => e.a === 1 || e.b === 1)).toHaveLength(1);
    expect(lifts(edges, 1, 6)).toEqual([[BRIDGE_RISE, low]]);
    // The longer bridge goes on from the split node to its own deck, the shorter to its own.
    expect(lifts(edges, 6, 7)).toEqual([[low, deckLift(longLevel)]]);
    expect(lifts(edges, 6, 9)).toEqual([[low, deckLift(shortLevel)]]);
    expect(lifts(edges, 7, 8)).toEqual([[deckLift(longLevel), deckLift(longLevel)]]);
    expect(lifts(edges, 8, 3)).toEqual([[deckLift(longLevel), BRIDGE_RISE]]);
    expect(lifts(edges, 9, 5)).toEqual([[deckLift(shortLevel), BRIDGE_RISE]]);
  });

  it("splits the longer last run too, and joins a bridge that arrives to one that leaves", () => {
    const { nodes, edges } = bridgeChains(
      [
        // Leaves the gate east for 70 m ...
        bridge(
          [
            [0, 0],
            [70, 0],
            [70, 300],
            [500, 300],
          ],
          0,
        ),
        // ... and one arrives from the east, its last run 40 m.
        bridge(
          [
            [500, -200],
            [40, -200],
            [40, 0],
            [0, 0],
          ],
          1,
        ),
      ],
      [
        [1, 3],
        [5, 1],
      ],
      FIRST,
      0,
      0,
    );
    expect(spots(nodes)).toEqual([
      [40, 0],
      [70, 0],
      [70, 300],
      [40, -200],
    ]);
    expect(edges).toHaveLength(6);
    expect(edges.filter((e) => e.a === 1 || e.b === 1)).toHaveLength(1);
    expect(lifts(edges, 1, 6)).toEqual([[BRIDGE_RISE, deckLift(0)]]);
    expect(lifts(edges, 6, 7)).toEqual([[deckLift(0), deckLift(0)]]);
    expect(lifts(edges, 9, 6)).toEqual([[deckLift(1), deckLift(0)]]);
  });

  it("keeps apart the runs that only run alongside", () => {
    const { nodes } = bridgeChains(
      [
        bridge([
          [0, 0],
          [70, 0],
          [70, 300],
          [500, 300],
        ]),
        bridge([
          [0, 0],
          [40, 1],
          [40, -200],
          [500, -200],
        ]),
      ],
      [
        [1, 3],
        [1, 5],
      ],
      FIRST,
      0,
      0,
    );
    expect(nodes.length / 2).toBe(4);
  });
});

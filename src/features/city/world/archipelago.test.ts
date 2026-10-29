import { describe, expect, it } from "vitest";
import type { ArchipelagoBridge } from "../../../api/types";
import { buildWorld, focusIn } from "./buildings";
import { deckLift, mergeIslands, type IslandPart } from "./archipelago";
import { BRIDGE_RISE, POLY, ROAD, type CityMap } from "./map";
import { mapOf, square } from "./map.fixture";
import { buildRoads, pointOn, stubGates } from "./roads";

/**
 * An island 100 m square: a district 1 (the root's), a block 2 and a house 5 in it, a street from
 * node 0 (0, 0) to node 1 (50, 0), a gate at node 1 facing east.
 */
function island(generation: number): CityMap {
  return mapOf(
    [
      square(POLY.district, 1, 1, 10, 0, 0, 100),
      square(POLY.block, 2, 1, 10, 0, 0, 100),
      square(POLY.house, 5, 2, 10, 10, 10, 20),
    ],
    {
      generation,
      rev: generation + 10,
      nodes: new Float32Array([0, 0, 50, 0]),
      edges: [{ a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 }],
      gates: [{ node: 1, dx: 1, dz: 0, neighbour: 0 }],
    },
  );
}

const part = (generation: number, x: number, z: number): IslandPart => ({
  generation,
  map: island(generation),
  x,
  z,
});

const bridge = (
  a: [number, number],
  b: [number, number],
  points: [number, number][],
  level = 0,
): ArchipelagoBridge => ({ a, b, points, level });

/** Is node `to` reachable from node `from` over the edges? */
function connected(map: CityMap, from: number, to: number): boolean {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const n = todo.pop()!;
    for (const e of map.edges) {
      for (const [p, q] of [
        [e.a, e.b],
        [e.b, e.a],
      ]) {
        if (p === n && !seen.has(q)) {
          seen.add(q);
          todo.push(q);
        }
      }
    }
  }
  return seen.has(to);
}

describe("deckLift", () => {
  it("is 8 m on the first level and 5 m higher on each next", () => {
    expect(deckLift(0)).toBe(8);
    expect(deckLift(2)).toBe(18);
  });
});

describe("mergeIslands", () => {
  it("leaves a single island as it is", () => {
    const one = island(3);
    const merged = mergeIslands([{ generation: 3, map: one, x: 0, z: 0 }], []);
    expect(merged.generation).toBe(3);
    expect(merged.rev).toBe(13);
    expect([merged.width, merged.height]).toEqual([100, 100]);
    expect(merged.nodes).toEqual(one.nodes);
    expect(merged.edges).toEqual(one.edges);
    expect(merged.gates).toEqual(one.gates);
    expect(merged.polys).toEqual(one.polys);
    expect(merged.polys.every((p) => p.island === 0)).toBe(true);
  });

  it("puts the map's corner at the origin whatever the offsets", () => {
    // The first island is centred on (0, 0) in the archipelago: its offset is negative.
    const merged = mergeIslands([part(1, -50, -50), part(2, 300, -50)], []);
    expect(merged.origin).toEqual([-50, -50]);
    expect([merged.width, merged.height]).toEqual([450, 100]);
    expect(Array.from(merged.nodes)).toEqual([0, 0, 50, 0, 350, 0, 400, 0]);
    expect(merged.polys[0].points[0]).toBe(0);
    expect(merged.polys[3].points[0]).toBe(350);
    expect(merged.polys.map((p) => p.island)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("shifts the second island and joins the two by a bridge", () => {
    // Gate node 1 of island 0 is at (50, 0), that of island 1 at (1050, 0).
    const merged = mergeIslands(
      [part(1, 0, 0), part(2, 1000, 0)],
      [
        bridge(
          [0, 1],
          [1, 1],
          [
            [50, 0],
            [300, 0],
            [800, 0],
            [1050, 0],
          ],
        ),
      ],
    );
    expect(Array.from(merged.nodes.slice(4, 8))).toEqual([1000, 0, 1050, 0]);
    expect(merged.width).toBe(1100);
    expect(connected(merged, 0, 2)).toBe(true);
    expect(connected(mergeIslands([part(1, 0, 0), part(2, 1000, 0)], []), 0, 2)).toBe(false);

    const deck = merged.edges.filter((e) => e.bridge);
    expect(deck).toHaveLength(3);
    expect(deck.every((e) => e.cls === ROAD.highway)).toBe(true);
    // Up on the first straight, level in the middle, down on the last.
    expect(deck.map((e) => [e.liftA, e.liftB])).toEqual([
      [BRIDGE_RISE, 8],
      [8, 8],
      [8, BRIDGE_RISE],
    ]);
    // The island's own roads keep their edges and their lifts.
    expect(merged.edges.slice(0, 2).map((e) => [e.a, e.b, e.bridge])).toEqual([
      [0, 1, false],
      [2, 3, false],
    ]);
    // Both ends are gates of the islands: bridged, so no stub over the sea.
    expect(merged.gates.map((g) => [g.node, g.bridged])).toEqual([
      [1, true],
      [3, true],
    ]);
  });

  it("lifts a higher level to its deck, and lets a bridge of one segment rise and fall", () => {
    const merged = mergeIslands(
      [part(1, 0, 0), part(2, 1000, 0)],
      [
        bridge(
          [0, 1],
          [1, 1],
          [
            [50, 0],
            [1050, 0],
          ],
          1,
        ),
      ],
    );
    const deck = merged.edges.filter((e) => e.bridge);
    expect(deck.map((e) => [e.liftA, e.liftB])).toEqual([
      [BRIDGE_RISE, deckLift(1)],
      [deckLift(1), BRIDGE_RISE],
    ]);
    expect(Array.from(merged.nodes.slice(8, 10))).toEqual([550, 0]);
  });

  it("leaves a gate without a bridge to its stub", () => {
    const merged = mergeIslands(
      [part(1, 0, 0), part(2, 1000, 0), part(3, 0, 1000)],
      [
        bridge(
          [0, 1],
          [1, 1],
          [
            [50, 0],
            [300, 0],
            [1050, 0],
          ],
        ),
      ],
    );
    expect(merged.gates.map((g) => !!g.bridged)).toEqual([true, true, false]);
    expect(stubGates(merged).map((g) => g.node)).toEqual([5]);
  });

  it("makes bridges that leave a gate the same way one run up to the fork", () => {
    // Both leave (50, 0) east to (300, 0); then one goes on east, the other south to island 2.
    const parts = [part(1, 0, 0), part(2, 1000, 0), part(3, 0, 1000)];
    const merged = mergeIslands(parts, [
      bridge(
        [0, 1],
        [1, 1],
        [
          [50, 0],
          [300, 0],
          [1000, 0],
          [1050, 0],
        ],
        0,
      ),
      bridge(
        [0, 1],
        [2, 1],
        [
          [50, 0],
          [300, 0],
          [300, 1000],
          [50, 1000],
        ],
        1,
      ),
    ]);
    // Three islands of 2 nodes, and three new ones: the fork (300, 0), (1000, 0), (300, 1000).
    expect(merged.nodes.length / 2).toBe(9);
    const at = (x: number, z: number) =>
      Array.from({ length: 9 }, (_, i) => i).filter(
        (i) => merged.nodes[i * 2] === x && merged.nodes[i * 2 + 1] === z,
      );
    expect(at(300, 0)).toHaveLength(1);
    const fork = at(300, 0)[0];
    const deck = merged.edges.filter((e) => e.bridge);
    expect(deck).toHaveLength(5);
    // One edge leaves the gate; the shared run ramps to the lower deck (level 0).
    const out = deck.filter((e) => e.a === 1 || e.b === 1);
    expect(out).toHaveLength(1);
    expect([out[0].liftA, out[0].liftB]).toEqual([BRIDGE_RISE, deckLift(0)]);
    // After the fork each branch rises to its own deck, then falls to its gate.
    const branch = deck.filter((e) => e.a === fork);
    expect(branch.map((e) => [e.liftA, e.liftB]).sort((p, q) => p[1] - q[1])).toEqual([
      [deckLift(0), deckLift(0)],
      [deckLift(0), deckLift(1)],
    ]);
    expect(connected(merged, 1, 3)).toBe(true);
    expect(connected(merged, 1, 5)).toBe(true);
  });

  it("makes bridges that arrive at a gate the same way one run too", () => {
    const parts = [part(1, 0, 0), part(2, 1000, 0), part(3, 0, 1000)];
    const merged = mergeIslands(parts, [
      bridge(
        [1, 1],
        [0, 1],
        [
          [1050, 0],
          [900, 0],
          [300, 0],
          [50, 0],
        ],
      ),
      bridge(
        [2, 1],
        [0, 1],
        [
          [50, 1000],
          [300, 1000],
          [300, 0],
          [50, 0],
        ],
      ),
    ]);
    const deck = merged.edges.filter((e) => e.bridge);
    expect(deck).toHaveLength(5);
    // One edge arrives at the gate.
    expect(deck.filter((e) => e.a === 1 || e.b === 1)).toHaveLength(1);
  });

  it("gives houses of the same folder id on two islands their own island", () => {
    const merged = mergeIslands([part(1, 0, 0), part(2, 1000, 0)], []);
    const world = buildWorld(merged, null);
    expect(world.buildings.map((b) => [b.island, b.id])).toEqual([
      [0, 5],
      [1, 5],
    ]);
    expect(world.buildings.map((b) => b.district)).toEqual([1, 1]);
  });

  it("focuses on the island it was asked for only", () => {
    const merged = mergeIslands([part(1, 0, 0), part(2, 1000, 0)], []);
    expect(focusIn(merged, [1, 2, 5], 1)).toEqual({ island: 1, id: 5 });
    expect(focusIn(merged, [1, 2, 5], 2)).toBeNull();
    const world = buildWorld(merged, { island: 1, id: 5 });
    expect(world.buildings.map((b) => [b.island, b.dim])).toEqual([
      [0, true],
      [1, false],
    ]);
    // The box is that of island 1's house alone.
    expect(world.focusBox?.min[0]).toBe(1010);
  });

  it("walks a car up the ramp of a bridge", () => {
    const merged = mergeIslands(
      [part(1, 0, 0), part(2, 1000, 0)],
      [
        bridge(
          [0, 1],
          [1, 1],
          [
            [50, 0],
            [300, 0],
            [800, 0],
            [1050, 0],
          ],
        ),
      ],
    );
    const g = buildRoads(merged);
    const ramp = g.edges.findIndex((e) => e.bridge);
    // Half way up the first straight: half way between the gate's rise and the deck.
    const mid = pointOn(g, ramp, g.edges[ramp].len / 2, true, 0);
    expect(mid.y).toBeCloseTo((BRIDGE_RISE + 8) / 2);
    // Going back down it from the deck end.
    expect(pointOn(g, ramp, 0, false, 0).y).toBe(8);
  });

  it("refuses an empty archipelago and a bridge to a missing island", () => {
    expect(() => mergeIslands([], [])).toThrow();
    expect(() =>
      mergeIslands(
        [part(1, 0, 0)],
        [
          bridge(
            [0, 1],
            [3, 1],
            [
              [50, 0],
              [90, 0],
            ],
          ),
        ],
      ),
    ).toThrow();
  });
});

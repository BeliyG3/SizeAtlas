import { buildWorld, type World } from "../world/buildings";
import { POLY, ROAD, type MapEdge, type Poly } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { deckLift } from "../world/bridgeChains";
import { RAMP, rampedEdges } from "../world/bridgeRamps";
import { buildRoads, type RoadGraph } from "../world/roads";
import { createSolids, type Solids } from "./solids";

/** A house for `canalWorld`: the rectangle `x…x + w` by `z…z + d`, `h` metres high. */
export interface House {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** A rectangle polygon, counter-clockwise by the shoelace formula. */
export function rect(
  kind: Poly["kind"],
  id: number,
  x: number,
  z: number,
  w: number,
  d: number,
): Poly {
  const points = new Float32Array([x, z, x + w, z, x + w, z + d, x, z + d]);
  return { island: 0, kind, id, parent: 1, size: 1, points };
}

/**
 * A 200 × 100 m island cut by a canal (x 90…110) that a street crosses on a 40 m bridge at
 * z = 50 (x 80…120, deck at 1 m), with `houses` standing on it; for tests.
 */
export function canalWorld(houses: House[] = []): {
  world: World;
  roads: RoadGraph;
  solids: Solids;
} {
  const bridge = (a: number, b: number, lift: number): MapEdge => ({
    a,
    b,
    cls: ROAD.street,
    bridge: lift > 0,
    liftA: lift,
    liftB: lift,
  });
  const map = mapOf(
    [
      rect(POLY.island, 1, 0, 0, 200, 100),
      rect(POLY.water, 1, 90, 0, 20, 100),
      ...houses.map((h, i) => rect(POLY.house, 10 + i, h.x, h.z, h.w, h.d)),
    ],
    {
      width: 200,
      height: 100,
      nodes: new Float32Array([60, 50, 80, 50, 120, 50, 140, 50]),
      edges: [bridge(0, 1, 0), bridge(1, 2, 1), bridge(2, 3, 0)],
    },
  );
  const world = buildWorld(map, null);
  world.buildings.forEach((b, i) => (b.h = houses[i].h));
  const roads = buildRoads(map);
  return { world, roads, solids: createSolids(world, roads) };
}

/**
 * Two 100 × 100 m islands (x 0…100 and 240…340) with the sea between, joined by a bridge between
 * their gates at (100, 50) and (240, 50): it climbs from the gate to the deck of level 0 over
 * its first run, `climb` metres long, and comes down over its last 40 m, as the archipelago
 * lifts its bridges. A highway on each island leads to its gate. For tests.
 */
export function bridgeWorld(climb = RAMP): { world: World; roads: RoadGraph; solids: Solids } {
  // Nodes: the island roads' ends, the gates (1, 2), then the bridge's turns (4, 5).
  const nodes = [60, 50, 100, 50, 240, 50, 280, 50, 100 + climb, 50, 200, 50];
  const ground = (a: number, b: number): MapEdge => ({
    a,
    b,
    cls: ROAD.highway,
    bridge: false,
    liftA: 0,
    liftB: 0,
  });
  const runs = [
    [1, 4],
    [4, 5],
    [5, 2],
  ].map(([a, b]) => ({ a, b, deck: deckLift(0) }));
  const deck = rampedEdges(
    runs,
    (n) => [nodes[n * 2], nodes[n * 2 + 1]],
    (n) => n === 1 || n === 2,
    (x, z) => nodes.push(x, z) / 2 - 1,
  );
  const map = mapOf(
    [rect(POLY.island, 1, 0, 0, 100, 100), rect(POLY.island, 2, 240, 0, 100, 100)],
    {
      width: 340,
      height: 100,
      nodes: new Float32Array(nodes),
      edges: [ground(0, 1), ground(2, 3), ...deck],
    },
  );
  const world = buildWorld(map, null);
  const roads = buildRoads(map);
  return { world, roads, solids: createSolids(world, roads) };
}

import { buildWorld, type World } from "../world/buildings";
import { POLY, ROAD, type MapEdge, type Poly } from "../world/map";
import { mapOf } from "../world/map.fixture";
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

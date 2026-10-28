/** The road graph of the island, ready for the traffic; pure, no three.js. */
import { ROAD_WIDTH, type CityMap, type RoadKind } from "./map";

export interface RoadEdge {
  a: number;
  b: number;
  cls: RoadKind;
  bridge: boolean;
  /** Length in metres. */
  len: number;
}

export interface RoadGraph {
  /** `x0, z0, x1, z1, …` */
  nodes: Float32Array;
  edges: RoadEdge[];
  /** For each node, the indices of the edges that start or end there. */
  links: number[][];
}

export function buildRoads(map: CityMap): RoadGraph {
  const { nodes } = map;
  const links: number[][] = Array.from({ length: nodes.length / 2 }, () => []);
  const edges = map.edges.map((e, i) => {
    links[e.a].push(i);
    links[e.b].push(i);
    const len = Math.hypot(
      nodes[e.b * 2] - nodes[e.a * 2],
      nodes[e.b * 2 + 1] - nodes[e.a * 2 + 1],
    );
    return { ...e, len };
  });
  return { nodes, edges, links };
}

/** A bridge's deck stands this high over the ground, metres. */
export const BRIDGE_RISE = 1;

/** Half the width of a road of class `cls`, metres. */
export function roadHalf(cls: RoadKind): number {
  return ROAD_WIDTH[cls] / 2;
}

/**
 * The point `s` metres from the start of `edge` along the way (`forward`: from a to b), moved
 * `offset` metres to the right of the direction of travel (going toward +X, right is +Z).
 * `heading` is `atan2(dx, dz)` of the direction.
 */
export function pointOn(
  g: RoadGraph,
  edge: number,
  s: number,
  forward: boolean,
  offset: number,
): { x: number; z: number; heading: number } {
  const e = g.edges[edge];
  const [from, to] = forward ? [e.a, e.b] : [e.b, e.a];
  const x0 = g.nodes[from * 2];
  const z0 = g.nodes[from * 2 + 1];
  const len = e.len || 1;
  const dx = (g.nodes[to * 2] - x0) / len;
  const dz = (g.nodes[to * 2 + 1] - z0) / len;
  return {
    x: x0 + dx * s - dz * offset,
    z: z0 + dz * s + dx * offset,
    heading: Math.atan2(dx, dz),
  };
}

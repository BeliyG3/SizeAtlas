/** The road graph of the island, ready for the traffic; pure, no three.js. */
import { ROAD_WIDTH, type CityMap, type Gate, type RoadKind } from "./map";

export interface RoadEdge {
  a: number;
  b: number;
  cls: RoadKind;
  bridge: boolean;
  liftA: number;
  liftB: number;
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

/** The gates that get a bridge stub out over the sea: those no bridge to another island starts at. */
export function stubGates(map: CityMap): Gate[] {
  return map.gates.filter((g) => !g.bridged);
}

/** Half the width of a road of class `cls`, metres. */
export function roadHalf(cls: RoadKind): number {
  return ROAD_WIDTH[cls] / 2;
}

/** A point on a road and the heading of the travel there. */
export interface RoadPoint {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/**
 * The point `s` metres from the start of `edge` along the way (`forward`: from a to b), moved
 * `offset` metres to the right of the direction of travel (going toward +X, right is +Z).
 * `heading` is `atan2(dx, dz)` of the direction. `y` is the road's height there, between the
 * lifts of the edge's ends. Written into `out`, so a frame can reuse one.
 */
export function pointOn(
  g: RoadGraph,
  edge: number,
  s: number,
  forward: boolean,
  offset: number,
  out: RoadPoint = { x: 0, y: 0, z: 0, heading: 0 },
): RoadPoint {
  const e = g.edges[edge];
  const [from, to] = forward ? [e.a, e.b] : [e.b, e.a];
  const x0 = g.nodes[from * 2];
  const z0 = g.nodes[from * 2 + 1];
  const len = e.len || 1;
  const [y0, y1] = forward ? [e.liftA, e.liftB] : [e.liftB, e.liftA];
  const dx = (g.nodes[to * 2] - x0) / len;
  const dz = (g.nodes[to * 2 + 1] - z0) / len;
  out.x = x0 + dx * s - dz * offset;
  out.y = y0 + ((y1 - y0) * s) / len;
  out.z = z0 + dz * s + dx * offset;
  out.heading = Math.atan2(dx, dz);
  return out;
}

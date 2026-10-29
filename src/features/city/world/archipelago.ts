/**
 * The islands of the open drives and their bridges as one `CityMap`, so that the world, roads,
 * traffic and renderers work on the archipelago as on one big island; pure, no three.js.
 */
import type { ArchipelagoBridge } from "../../../api/types";
import { bridgeChains } from "./bridgeChains";
import type { CityMap, Gate, MapEdge, Poly } from "./map";

export { deckLift } from "./bridgeChains";

/** One island's map and where it lies: `(x, z)` is added to its own coordinates. */
export interface IslandPart {
  generation: number;
  map: CityMap;
  x: number;
  z: number;
}

/**
 * One map of `parts` (an island each, in this order) joined by `bridges`.
 *
 * Coordinates are shifted so that the map's corner (0, 0) is the south-west of everything
 * (islands and bridges); `origin` tells where that corner lies in the world the offsets and
 * bridge points are in, and `width`/`height` cover all of it. Nodes are numbered island by
 * island, then the nodes of the bridges; the edges and the gates of an island keep their order,
 * the bridges' edges follow. Each polygon carries its part's index as `island`.
 *
 * `generation` and `rev` are those of `parts[0]` (the caller orders the parts; the first one
 * is the one whose revision the view follows), `approximate` holds if any part is.
 */
export function mergeIslands(parts: IslandPart[], allBridges: ArchipelagoBridge[]): CityMap {
  if (parts.length === 0) throw new Error("an archipelago needs an island");
  // A bridge of fewer than two points goes nowhere: it is no bridge, and its gates keep their stubs.
  const bridges = allBridges.filter((b) => b.points.length >= 2);
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  const reach = (x: number, z: number) => {
    lo[0] = Math.min(lo[0], x);
    lo[1] = Math.min(lo[1], z);
    hi[0] = Math.max(hi[0], x);
    hi[1] = Math.max(hi[1], z);
  };
  for (const p of parts) {
    reach(p.x, p.z);
    reach(p.x + p.map.width, p.z + p.map.height);
  }
  for (const b of bridges) for (const [x, z] of b.points) reach(x, z);
  const [ox, oz] = lo;

  // The first node of each part, and the gate nodes the bridges leave from and arrive at.
  const base: number[] = [];
  let count = 0;
  for (const p of parts) {
    base.push(count);
    count += p.map.nodes.length / 2;
  }
  const bridged = new Set<number>();
  const ends = bridges.map((b): [number, number] => {
    const [from, to] = [b.a, b.b].map(([island, node]) => {
      if (!(island >= 0 && island < parts.length)) {
        throw new Error(`no island ${island} for a bridge`);
      }
      if (!(node >= 0 && node < parts[island].map.nodes.length / 2)) {
        throw new Error(`no node ${node} on island ${island} for a bridge`);
      }
      const gate = base[island] + node;
      bridged.add(gate);
      return gate;
    });
    return [from, to];
  });
  const chains = bridgeChains(bridges, ends, count, -ox, -oz);

  const nodes = new Float32Array(count * 2 + chains.nodes.length);
  const polys: Poly[] = [];
  const edges: MapEdge[] = [];
  const gates: Gate[] = [];
  parts.forEach((p, island) => {
    const [dx, dz] = [p.x - ox, p.z - oz];
    const at = base[island] * 2;
    p.map.nodes.forEach((v, i) => (nodes[at + i] = v + (i % 2 ? dz : dx)));
    for (const poly of p.map.polys) {
      const points = poly.points.map((v, i) => v + (i % 2 ? dz : dx));
      polys.push({ ...poly, island, points });
    }
    for (const e of p.map.edges) edges.push({ ...e, a: e.a + base[island], b: e.b + base[island] });
    for (const g of p.map.gates) {
      const node = g.node + base[island];
      gates.push(bridged.has(node) ? { ...g, node, bridged: true } : { ...g, node });
    }
  });
  nodes.set(chains.nodes, count * 2);
  edges.push(...chains.edges);

  return {
    generation: parts[0].generation,
    rev: parts[0].map.rev,
    build: 0,
    approximate: parts.some((p) => p.map.approximate),
    width: hi[0] - ox,
    height: hi[1] - oz,
    origin: [ox, oz],
    polys,
    nodes,
    edges,
    gates,
  };
}

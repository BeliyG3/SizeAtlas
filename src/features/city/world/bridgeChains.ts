/**
 * The bridges between islands as nodes and edges of the merged map; pure, no three.js. Bridges
 * are merged by place, not by gate: where bridges run together over the sea they are one chain,
 * with a node at every fork.
 */
import type { ArchipelagoBridge } from "../../../api/types";
import type { MapEdge } from "./map";
import { rampedEdges, type Run } from "./bridgeRamps";

/** The deck of a run on `level`, metres over the sea: levels are 5 m apart. */
export const deckLift = (level: number) => 8 + 5 * level;

/** Points closer than this, metres, are one; a point this close to a run lies on it. */
const SAME = 0.01;

type Pt = [number, number];

export interface BridgeChains {
  /** The new nodes, `x0, z0, …`; they are numbered from `first`. */
  nodes: number[];
  edges: MapEdge[];
}

/**
 * The nodes and edges of `bridges`. `ends[i]` is the merged-map index of the gate nodes at the
 * start and at the end of bridge `i`; `first` is the index the first new node gets (the gates
 * are all below it); `(dx, dz)` is added to the bridges' points.
 *
 * Points within `SAME` of each other, in any bridge, are one node; a run that another bridge's
 * point lies inside is split there. The runs between the same two nodes are one edge (the first
 * one's deck counts: bridges that share a run agree on its level). Heights: see `rampedEdges`.
 * A bridge of one run gets a node in its middle to rise to and fall from.
 */
export function bridgeChains(
  bridges: ArchipelagoBridge[],
  ends: [number, number][],
  first: number,
  dx: number,
  dz: number,
): BridgeChains {
  const nodes: number[] = [];
  const at = new Map<number, Pt>(); // by node, unshifted
  const placed: { id: number; at: Pt }[] = [];
  const addNode = (x: number, z: number) => {
    nodes.push(x + dx, z + dz);
    return first + nodes.length / 2 - 1;
  };
  const nodeAt = (p: Pt, gate?: number) => {
    const hit = placed.find((n) => Math.hypot(n.at[0] - p[0], n.at[1] - p[1]) <= SAME);
    if (hit) return hit.id;
    const id = gate ?? addNode(p[0], p[1]);
    placed.push({ id, at: p });
    at.set(id, p);
    return id;
  };

  const routes = bridges.map(({ points, levels }, i) => {
    const level = (k: number) => levels[k] ?? levels[levels.length - 1] ?? 0;
    let way = points;
    let runs = points.slice(1).map((_, k) => level(k));
    if (way.length === 2) {
      way = [way[0], [(way[0][0] + way[1][0]) / 2, (way[0][1] + way[1][1]) / 2], way[1]];
      runs = [runs[0], runs[0]];
    }
    const last = way.length - 1;
    const ids = way.map((p, k) =>
      nodeAt(p, k === 0 ? ends[i][0] : k === last ? ends[i][1] : undefined),
    );
    return { ids, runs };
  });

  const runs = new Map<string, Run>();
  for (const { ids, runs: levels } of routes) {
    for (let k = 0; k + 1 < ids.length; k++) {
      const [p, q] = [at.get(ids[k])!, at.get(ids[k + 1])!];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const inside = placed
        .map((n) => ({ id: n.id, along: along(n.at, p, q, len) }))
        .filter((n) => n.along !== null && n.id !== ids[k] && n.id !== ids[k + 1])
        .sort((m, n) => m.along! - n.along!);
      const chain = [ids[k], ...inside.map((n) => n.id), ids[k + 1]];
      for (let j = 0; j + 1 < chain.length; j++) {
        const [a, b] = [chain[j], chain[j + 1]];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (a !== b && !runs.has(key)) runs.set(key, { a, b, deck: deckLift(levels[k]) });
      }
    }
  }
  const edges = rampedEdges(
    [...runs.values()],
    (node) => at.get(node)!,
    (node) => node < first,
    (x, z) => addNode(x, z),
  );
  return { nodes, edges };
}

/** How far `v` lies along the run `p`-`q` (of length `len`) if it is strictly inside it, else null. */
function along(v: Pt, p: Pt, q: Pt, len: number): number | null {
  if (!(len > 0)) return null;
  const [ux, uz] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  const [wx, wz] = [v[0] - p[0], v[1] - p[1]];
  const t = wx * ux + wz * uz;
  const aside = Math.abs(wx * uz - wz * ux);
  return aside <= SAME && t > SAME && t < len - SAME ? t : null;
}

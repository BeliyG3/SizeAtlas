/**
 * The bridges between islands as nodes and edges of the merged map; pure, no three.js. Each
 * bridge is a chain of road edges over the sea that rises from the height of its gate to its
 * deck on the first straight run, stays there, and falls on the last one.
 */
import type { ArchipelagoBridge } from "../../../api/types";
import { BRIDGE_RISE, ROAD, type MapEdge } from "./map";

/** The deck of a bridge on `level`, metres over the sea: levels are 5 m apart. */
export const deckLift = (level: number) => 8 + 5 * level;

/** Points closer than this, metres, are one (the cells of the key); lines this close are one. */
const SAME = 0.01;
const cell = (v: number) => Math.round(v / SAME);

type Pt = [number, number];

export interface BridgeChains {
  /** The new nodes, `x0, z0, …`; they are numbered from `first`. */
  nodes: number[];
  edges: MapEdge[];
}

/**
 * The nodes and edges of `bridges`. `ends[i]` is the merged-map index of the gate nodes at the
 * start and at the end of bridge `i`; `first` is the index the first new node gets; `(dx, dz)` is
 * added to the bridges' points.
 *
 * Bridges that set out from or come in to one gate the same way share their nodes and edges up
 * to the fork, whichever way they go: the first runs may differ in length, the shorter one's end
 * then splits the longer one. A shared node stands as high as the lowest deck over it, so the
 * run is a ramp to the lower deck and each branch goes on to its own.
 * ponytail: a node that one bridge shares by the way behind it and another by the way ahead joins
 * the first only; the forks of such a trio are rare, and need a graph merge to do better.
 */
export function bridgeChains(
  bridges: ArchipelagoBridge[],
  ends: [number, number][],
  first: number,
  dx: number,
  dz: number,
): BridgeChains {
  const ways = withSplits(bridges, ends);

  // How many bridges pass a point with the same way from a gate behind it: the key is the gate
  // and the points out from it, so a bridge that leaves a gate and one that arrives share it.
  const before: string[][] = [];
  const after: string[][] = [];
  const count = new Map<string, number>();
  const seen = (key: string) => count.set(key, (count.get(key) ?? 0) + 1);
  ways.forEach((points, i) => {
    const last = points.length - 1;
    before[i] = [];
    after[i] = [];
    let key = `${ends[i][0]}`;
    for (let k = 1; k < last; k++) {
      key += `|${cell(points[k][0])},${cell(points[k][1])}`;
      before[i][k] = key;
      seen(key);
    }
    key = `${ends[i][1]}`;
    for (let k = last - 1; k >= 1; k--) {
      key += `|${cell(points[k][0])},${cell(points[k][1])}`;
      after[i][k] = key;
      seen(key);
    }
  });

  const nodes: number[] = [];
  const ids = new Map<string, number>();
  const lift = new Map<number, number>(); // by node: the lowest deck over it
  const add = (x: number, z: number, key: string | null, height: number) => {
    let id = key === null ? undefined : ids.get(key);
    if (id === undefined) {
      id = first + nodes.length / 2;
      nodes.push(x + dx, z + dz);
      if (key !== null) ids.set(key, id);
    }
    lift.set(id, Math.min(lift.get(id) ?? Infinity, height));
    return id;
  };

  const chains: number[][] = [];
  ways.forEach((points, i) => {
    const deck = deckLift(bridges[i].level);
    // A bridge of one straight run gets a node in its middle to rise to and fall from.
    const way =
      points.length > 2
        ? points
        : [
            points[0],
            [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2],
            points[1],
          ];
    const chain = [ends[i][0]];
    for (let k = 1; k < way.length - 1; k++) {
      let key: string | null = null;
      if (points.length > 2) {
        const [b, a] = [before[i][k], after[i][k]];
        key = (count.get(b) ?? 0) > 1 || (count.get(a) ?? 0) <= 1 ? b : a;
      }
      chain.push(add(way[k][0], way[k][1], key, deck));
    }
    chain.push(ends[i][1]);
    chains.push(chain);
  });

  const edges: MapEdge[] = [];
  const made = new Set<string>();
  const height = (node: number) => lift.get(node) ?? BRIDGE_RISE; // a gate node: where the bridge leaves it
  for (const chain of chains) {
    for (let k = 0; k + 1 < chain.length; k++) {
      const [a, b] = [chain[k], chain[k + 1]];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (made.has(key)) continue;
      made.add(key);
      edges.push({ a, b, cls: ROAD.highway, bridge: true, liftA: height(a), liftB: height(b) });
    }
  }
  return { nodes, edges };
}

/**
 * The points of the bridges, copied, with the end of every run that is shorter than another's
 * out of the same gate and along the same line added to the longer one as a point (at both ends of
 * a bridge: a bridge's run out of the gate it arrives at counts as well).
 */
function withSplits(bridges: ArchipelagoBridge[], ends: [number, number][]): Pt[][] {
  const ways = bridges.map((b) => b.points.map((p): Pt => [p[0], p[1]]));
  // The runs out of each gate: the bridge, which end it is, and the points from the gate on.
  const arms = new Map<number, { bridge: number; atEnd: boolean; out: Pt[] }[]>();
  ways.forEach((points, bridge) => {
    for (const atEnd of [false, true]) {
      const gate = ends[bridge][atEnd ? 1 : 0];
      const out = atEnd ? [...points].reverse() : points;
      arms.set(gate, [...(arms.get(gate) ?? []), { bridge, atEnd, out }]);
    }
  });
  const splits = new Map<{ bridge: number; atEnd: boolean }, Pt[]>();
  for (const group of arms.values()) {
    for (const host of group) {
      const [from, to] = host.out;
      const run = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const found: { at: number; corner: Pt }[] = [];
      for (const other of group) {
        // A corner is a point that is not the end of the bridge.
        if (other.bridge === host.bridge || other.out.length < 3) continue;
        const corner = other.out[1];
        const [vx, vz] = [to[0] - from[0], to[1] - from[1]];
        const [wx, wz] = [corner[0] - from[0], corner[1] - from[1]];
        const along = (wx * vx + wz * vz) / run;
        const aside = Math.abs(wx * vz - wz * vx) / run;
        if (aside > SAME || along <= SAME || along >= run - SAME) continue;
        if (!found.some((f) => Math.abs(f.at - along) <= SAME)) found.push({ at: along, corner });
      }
      if (found.length)
        splits.set(
          host,
          found.sort((p, q) => p.at - q.at).map((f) => f.corner),
        );
    }
  }
  for (const [host, corners] of splits) {
    const way = ways[host.bridge];
    if (host.atEnd) way.splice(way.length - 1, 0, ...[...corners].reverse());
    else way.splice(1, 0, ...corners);
  }
  return ways;
}

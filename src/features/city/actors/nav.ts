/** Random walks along the road graph for cars and walkers; pure, no three.js. */
import type { RoadEdge, RoadGraph } from "../world/roads";

/** Decides which edges a mover may use (cars stay off lanes, walkers off highways). */
export type Allow = (edge: RoadEdge) => boolean;

/** Positions of movers as flat arrays: `s` is metres from the start of travel on `edge[i]`. */
export interface Track {
  edge: Int32Array;
  s: Float32Array;
  /** 1 when travelling from the edge's `a` to its `b`. */
  forward: Uint8Array;
}

/** mulberry32: a small seeded generator giving numbers in `[0, 1)`. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random allowed edge of `node` other than `from`. With none, `from` itself: a U-turn at a
 * dead end.
 */
export function nextEdge(
  g: RoadGraph,
  node: number,
  from: number,
  rand: () => number,
  allow?: Allow,
): number {
  const options = g.links[node].filter((e) => e !== from && (!allow || allow(g.edges[e])));
  return options.length ? options[Math.floor(rand() * options.length)] : from;
}

// ponytail: at most this many nodes per step, so a loop of zero-length edges cannot hang a frame.
const MAX_HOPS = 100;

/** Moves mover `i` on by `dist` metres, turning at nodes as often as the distance needs. */
export function advance(
  g: RoadGraph,
  t: Track,
  i: number,
  dist: number,
  rand: () => number,
  allow?: Allow,
): void {
  let edge = t.edge[i];
  let forward = t.forward[i] === 1;
  let s = t.s[i] + dist;
  for (let hop = 0; hop < MAX_HOPS && s > g.edges[edge].len; hop++) {
    s -= g.edges[edge].len;
    const node = forward ? g.edges[edge].b : g.edges[edge].a;
    edge = nextEdge(g, node, edge, rand, allow);
    forward = g.edges[edge].a === node;
  }
  t.edge[i] = edge;
  t.forward[i] = forward ? 1 : 0;
  t.s[i] = Math.min(s, g.edges[edge].len);
}

/** Puts mover `i` at a random spot of a random allowed edge; unchanged if no edge is allowed. */
export function place(g: RoadGraph, t: Track, i: number, rand: () => number, allow?: Allow): void {
  const ok = (e: RoadEdge) => !allow || allow(e);
  const count = g.edges.reduce((n, e) => n + (ok(e) ? 1 : 0), 0);
  if (!count) return;
  let k = Math.floor(rand() * count);
  const edge = g.edges.findIndex((e) => ok(e) && k-- === 0);
  t.edge[i] = edge;
  t.forward[i] = rand() < 0.5 ? 1 : 0;
  t.s[i] = rand() * g.edges[edge].len;
}

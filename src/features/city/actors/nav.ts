/**
 * Random walks along the road graph for cars and walkers, and the locals who keep near the
 * camera's target; pure, no three.js.
 */
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

/** Share of a crowd that keeps near the camera's target: the locals. */
export const LOCAL_SHARE = 0.5;
/** A local is looked at once per this many seconds. */
export const RECHECK = 0.5;
/** A moved local grows in over this many seconds. */
export const APPEAR = 0.5;
/** A stray local is put back this share of the circle's radius from its centre, or farther... */
export const RING_INNER = 0.6;
/** ...and kept this far from the circle's edge, in its radius. */
export const RING_MOVE = 0.05;
/**
 * ...but no farther than this share: a ring is kept while its circle moves or resizes by up to
 * `RING_MOVE` of it, and its spots stay inside the circle all the while.
 */
export const RING_OUTER = 1 - 2 * RING_MOVE;

/** The circle the locals keep to: around the camera's target, `r` metres wide. */
export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** The locals' radius for a camera `distance` metres from its target: nearer, smaller and denser. */
export function localRadius(distance: number): number {
  return Math.min(2000, Math.max(150, 0.8 * distance));
}

/**
 * Stretches of edges to put movers on: edge `edge[k]` from `s0[k]` to `s1[k]` metres from its
 * `a`; `end[k]` is the length of the stretches up to and including `k`.
 */
export interface Spots {
  edge: number[];
  s0: number[];
  s1: number[];
  end: number[];
}

/** The stretches of allowed edges that lie `RING_INNER·r … RING_OUTER·r` from the circle's centre. */
export function ringSpots(g: RoadGraph, c: Circle, allow?: Allow): Spots {
  const out: Spots = { edge: [], s0: [], s1: [], end: [] };
  let total = 0;
  g.edges.forEach((e, edge) => {
    if (!e.len || (allow && !allow(e))) return;
    const ux = (g.nodes[e.b * 2] - g.nodes[e.a * 2]) / e.len;
    const uz = (g.nodes[e.b * 2 + 1] - g.nodes[e.a * 2 + 1]) / e.len;
    const wx = g.nodes[e.a * 2] - c.x;
    const wz = g.nodes[e.a * 2 + 1] - c.z;
    const b = ux * wx + uz * wz;
    const w2 = wx * wx + wz * wz;
    // Where the edge's line is `r` from the centre: |w + u·s|² = r².
    const cut = (r: number): [number, number] | null => {
      const d = b * b - w2 + r * r;
      return d < 0 ? null : [-b - Math.sqrt(d), -b + Math.sqrt(d)];
    };
    const add = (from: number, to: number) => {
      const lo = Math.max(0, from);
      const hi = Math.min(e.len, to);
      if (hi <= lo) return;
      total += hi - lo;
      out.edge.push(edge);
      out.s0.push(lo);
      out.s1.push(hi);
      out.end.push(total);
    };
    const outer = cut(RING_OUTER * c.r);
    if (!outer) return;
    const inner = cut(RING_INNER * c.r);
    if (!inner) return add(outer[0], outer[1]);
    add(outer[0], inner[0]);
    add(inner[1], outer[1]);
  });
  return out;
}

/** Puts mover `i` at a random spot of `spots`, even along them; false (unchanged) if there are none. */
export function placeOn(
  g: RoadGraph,
  t: Track,
  i: number,
  spots: Spots,
  rand: () => number,
): boolean {
  const total = spots.end.at(-1) ?? 0;
  if (!(total > 0)) return false;
  const u = rand() * total;
  // The first stretch that ends past `u`.
  let k = 0;
  for (let hi = spots.end.length - 1; k < hi;) {
    const mid = (k + hi) >> 1;
    if (spots.end[mid] <= u) k = mid + 1;
    else hi = mid;
  }
  const s = Math.min(spots.s1[k], Math.max(spots.s0[k], spots.s1[k] - (spots.end[k] - u)));
  const forward = rand() < 0.5;
  t.edge[i] = spots.edge[k];
  t.forward[i] = forward ? 1 : 0;
  t.s[i] = forward ? s : g.edges[spots.edge[k]].len - s;
  return true;
}

/** The first `LOCAL_SHARE` of the `count` movers from `from` on: the locals of that group. */
export function localIds(from: number, count: number): number[] {
  return Array.from({ length: Math.round(count * LOCAL_SHARE) }, (_, k) => from + k);
}

/**
 * The locals of a crowd of `n`: the movers `ids` keep near a circle. Round the list, each is
 * looked at once per `RECHECK` seconds; one that has strayed farther than `r` (horizontally) from
 * the centre goes to `move`, which puts it on one of the spots it asks for (the ring of the
 * circle, for the edges it may use) and says whether it could. A moved one grows in: its
 * `appear` goes from 0 to 1 over `APPEAR` seconds.
 */
export function createLocals(g: RoadGraph, n: number, ids: number[]) {
  const appear = new Float32Array(n).fill(1);
  let next = 0;
  let due = 0;
  // The rings of the circle they were worked out for, each the first time a stray needed it;
  // kept until the circle moves or resizes by more than `RING_MOVE` of it.
  let ringOf: Circle | null = null;
  let rings = new Map<Allow, Spots>();
  const spots = (allow: Allow) => {
    let s = rings.get(allow);
    if (!s) rings.set(allow, (s = ringSpots(g, ringOf!, allow)));
    return s;
  };
  return {
    appear,
    update(
      dt: number,
      c: Circle | null,
      at: { x: ArrayLike<number>; z: ArrayLike<number> },
      move: (i: number, spots: (allow: Allow) => Spots) => boolean,
    ) {
      for (let i = 0; i < n; i++) {
        if (appear[i] < 1) appear[i] = Math.min(1, appear[i] + dt / APPEAR);
      }
      if (!c || !ids.length) return;
      const off = ringOf && RING_MOVE * ringOf.r;
      if (
        !ringOf ||
        Math.abs(c.x - ringOf.x) > off! ||
        Math.abs(c.z - ringOf.z) > off! ||
        Math.abs(c.r - ringOf.r) > off!
      ) {
        ringOf = { x: c.x, z: c.z, r: c.r };
        rings = new Map();
      }
      due = Math.min(ids.length, due + (ids.length * dt) / RECHECK);
      for (; due >= 1; due--) {
        const i = ids[next];
        next = (next + 1) % ids.length;
        if (Math.hypot(at.x[i] - c.x, at.z[i] - c.z) > c.r && move(i, spots)) appear[i] = 0;
      }
    },
  };
}

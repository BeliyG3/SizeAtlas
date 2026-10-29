/**
 * Routes for the far crowd: random walks along the road graph and back, sampled at an even step,
 * for the GPU to move particles along; pure, no three.js.
 */
import { laneOffset } from "../actors/junctions";
import { walkOffset, walks } from "../actors/residents";
import { drives } from "../actors/traffic";
import { nextEdge, rng, type Allow } from "../actors/nav";
import type { RoadKind } from "./map";
import { pointOn, type RoadGraph } from "./roads";

/** A route goes up to this many metres one way, then the same way back. */
export const ROUTE_LENGTH = 4000;
/** Metres between the points of a route. */
export const ROUTE_STEP = 4;
/** Steps of the longest route there and back. */
export const ROUTE_STEPS = (ROUTE_LENGTH * 2) / ROUTE_STEP;
/** Points kept per route: one per step and the closing one, back at the start. */
export const ROUTE_POINTS = ROUTE_STEPS + 1;

// ponytail: at most this many edges a walk, so a knot of zero-length edges cannot hang it.
const MAX_HOPS = 20000;

/** The edges a kind of the crowd keeps to, and how far right of their axis it goes. */
interface Kind {
  allow: Allow;
  side: (cls: RoadKind) => number;
}
const KINDS: Record<"drive" | "walk", Kind> = {
  // The centre of the inner lane.
  drive: { allow: drives, side: (cls) => laneOffset(cls, 0) },
  walk: { allow: walks, side: walkOffset },
};

export interface Routes {
  count: number;
  /**
   * `x, y, z, side` for each of `ROUTE_POINTS` points of each route, row by row, zeros past its
   * end; `side` (above 0) is how far right of the road's axis the kind goes there, metres.
   */
  points: Float32Array;
  /** Metres there and back of each route; its last point, at this distance, is its first. */
  length: Float32Array;
}

/**
 * Up to `count` routes for cars (`"drive"`) or walkers (`"walk"`) on the edges they use, the same
 * for the same `seed`. They start evenly over the length of those edges, so every island gets its
 * share; `y` is the deck's height on a bridge. A route shorter than a step is left out.
 */
export function buildRoutes(
  g: RoadGraph,
  kind: "drive" | "walk",
  count: number,
  seed: number,
): Routes {
  const use = KINDS[kind];
  const { allow } = use;
  const rand = rng(seed);
  const total = g.edges.reduce((sum, e) => sum + (allow(e) ? e.len : 0), 0);
  const n = total > 0 ? Math.max(0, Math.floor(count)) : 0;
  const points = new Float32Array(n * ROUTE_POINTS * 4);
  const length = new Float32Array(n);
  const ids = g.edges.flatMap((e, i) => (allow(e) ? [i] : []));
  let k = 0;
  let passed = 0; // the length of the allowed edges before `ids[k]`
  let kept = 0;
  for (let r = 0; r < n; r++) {
    // Route r starts in the r-th of n even shares of the roads.
    const u = ((r + rand()) / n) * total;
    while (k < ids.length - 1 && passed + g.edges[ids[k]].len <= u) passed += g.edges[ids[k++]].len;
    const edge = ids[k];
    const forward = rand() < 0.5;
    const s = Math.min(u - passed, g.edges[edge].len);
    const start = { edge, s: forward ? s : g.edges[edge].len - s, forward };
    const len = walk(g, start, rand, use, points, kept);
    if (len > 0) length[kept++] = len;
  }
  if (kept === n) return { count: n, points, length };
  return {
    count: kept,
    points: points.slice(0, kept * ROUTE_POINTS * 4),
    length: length.slice(0, kept),
  };
}

/**
 * Walks from `s` metres along `edge` (in `forward`) up to `ROUTE_LENGTH`, a whole number of
 * steps, writes the points of the way there and back as row `row` of `out`, and returns the
 * metres there and back; with less than a step, 0 and nothing written.
 */
function walk(
  g: RoadGraph,
  { edge, s, forward }: { edge: number; s: number; forward: boolean },
  rand: () => number,
  { allow, side }: Kind,
  out: Float32Array,
  row: number,
): number {
  // The way as stretches: from `at` metres of the walk on, `edge` from `s` on in `forward`.
  const legs = [{ edge, s, forward, at: 0 }];
  let end = g.edges[edge].len - s;
  for (let hop = 0; hop < MAX_HOPS && end < ROUTE_LENGTH; hop++) {
    const last = legs[legs.length - 1];
    const node = last.forward ? g.edges[last.edge].b : g.edges[last.edge].a;
    const next = nextEdge(g, node, last.edge, rand, allow);
    legs.push({ edge: next, s: 0, forward: g.edges[next].a === node, at: end });
    end += g.edges[next].len;
  }
  const steps = Math.floor(Math.min(end, ROUTE_LENGTH) / ROUTE_STEP);
  if (steps === 0) return 0;
  const base = row * ROUTE_POINTS * 4;
  const put = (k: number, p: { x: number; y: number; z: number }, w: number) => {
    const at = base + k * 4;
    out[at] = p.x;
    out[at + 1] = p.y;
    out[at + 2] = p.z;
    out[at + 3] = w;
  };
  let leg = 0;
  for (let k = 0; k <= steps; k++) {
    const d = k * ROUTE_STEP;
    while (leg < legs.length - 1 && legs[leg + 1].at <= d) leg++;
    const l = legs[leg];
    const p = pointOn(g, l.edge, Math.min(l.s + d - l.at, g.edges[l.edge].len), l.forward, 0);
    const w = side(g.edges[l.edge].cls);
    put(k, p, w);
    // Back the same way: point `2·steps − k` is point `k`.
    if (k < steps) put(2 * steps - k, p, w);
  }
  return 2 * steps * ROUTE_STEP;
}

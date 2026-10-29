/**
 * Routes for the far crowd: random walks along the road graph and back, sampled at an even step,
 * for the GPU to move particles along; pure, no three.js.
 */
import { walks } from "../actors/residents";
import { drives } from "../actors/traffic";
import { nextEdge, rng, type Allow } from "../actors/nav";
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

export interface Routes {
  count: number;
  /** `x, y, z, 1` for each of `ROUTE_POINTS` points of each route, row by row; zeros past its end. */
  points: Float32Array;
  /** Metres there and back of each route; its last point, at this distance, is its first. */
  length: Float32Array;
}

/**
 * `count` routes for cars (`"drive"`) or walkers (`"walk"`) on the edges they use, the same for
 * the same `seed`. They start evenly over the length of those edges, so every island gets its
 * share; `y` is the deck's height on a bridge.
 */
export function buildRoutes(
  g: RoadGraph,
  kind: "drive" | "walk",
  count: number,
  seed: number,
): Routes {
  const allow = kind === "drive" ? drives : walks;
  const rand = rng(seed);
  const total = g.edges.reduce((sum, e) => sum + (allow(e) ? e.len : 0), 0);
  const n = total > 0 ? Math.max(0, Math.floor(count)) : 0;
  const points = new Float32Array(n * ROUTE_POINTS * 4);
  const length = new Float32Array(n);
  const ids = g.edges.flatMap((e, i) => (allow(e) ? [i] : []));
  let k = 0;
  let passed = 0; // the length of the allowed edges before `ids[k]`
  for (let r = 0; r < n; r++) {
    // Route r starts in the r-th of n even shares of the roads.
    const u = ((r + rand()) / n) * total;
    while (k < ids.length - 1 && passed + g.edges[ids[k]].len <= u) passed += g.edges[ids[k++]].len;
    const edge = ids[k];
    const forward = rand() < 0.5;
    const s = Math.min(u - passed, g.edges[edge].len);
    length[r] = walk(g, edge, forward ? s : g.edges[edge].len - s, forward, rand, allow, points, r);
  }
  return { count: n, points, length };
}

/**
 * Walks from `s` metres along `edge` up to `ROUTE_LENGTH` (a whole number of steps), writes the
 * points of the way there and back as row `row` of `out`, and returns the metres there and back.
 */
function walk(
  g: RoadGraph,
  edge: number,
  s: number,
  forward: boolean,
  rand: () => number,
  allow: Allow,
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
  const base = row * ROUTE_POINTS * 4;
  const put = (k: number, p: { x: number; y: number; z: number }) => {
    const at = base + k * 4;
    out[at] = p.x;
    out[at + 1] = p.y;
    out[at + 2] = p.z;
    out[at + 3] = 1;
  };
  let leg = 0;
  for (let k = 0; k <= steps; k++) {
    const d = k * ROUTE_STEP;
    while (leg < legs.length - 1 && legs[leg + 1].at <= d) leg++;
    const l = legs[leg];
    const p = pointOn(g, l.edge, Math.min(l.s + d - l.at, g.edges[l.edge].len), l.forward, 0);
    put(k, p);
    // Back the same way: point `2·steps − k` is point `k`.
    if (k < steps) put(2 * steps - k, p);
  }
  return 2 * steps * ROUTE_STEP;
}

/**
 * The locals: movers who keep near the camera's target, so the life is where one looks. Strays
 * are put back on the roads around it, the whole circle filled anew after a jump; pure, no
 * three.js.
 */
import type { RoadGraph } from "../world/roads";
import type { Allow, Track } from "./nav";

/** Share of a crowd that keeps near the camera's target: the locals. */
export const LOCAL_SHARE = 1;
/** A local is looked at once per this many seconds. */
export const RECHECK = 0.5;
/** A moved local grows in over this many seconds. */
export const APPEAR = 0.5;
/** A stray local is put back this share of the circle's radius from its centre, or farther... */
export const RING_INNER = 0.6;
/** ...and kept this far from the circle's edge, in its radius. */
export const RING_MOVE = 0.05;
/**
 * ...but no farther than this share: spots are kept while their circle moves or resizes by up
 * to `RING_MOVE` of it, and stay inside the circle all the while.
 */
export const RING_OUTER = 1 - 2 * RING_MOVE;
/** The circle grown this many times since it was last this small: the view backed off. */
export const ZOOM_OUT = 1.5;

/** The circle the locals keep to: around the camera's target, `r` metres wide. */
export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Has the circle moved or resized by more than `RING_MOVE` of `from` (null: none yet)? */
export function drifted(from: Circle | null, to: Circle): boolean {
  if (!from) return true;
  const off = RING_MOVE * from.r;
  return (
    Math.abs(to.x - from.x) > off || Math.abs(to.z - from.z) > off || Math.abs(to.r - from.r) > off
  );
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

/**
 * The stretches of allowed edges that lie `from … to` metres from the circle's centre, by
 * default its ring, `RING_INNER·r … RING_OUTER·r`.
 */
export function ringSpots(
  g: RoadGraph,
  c: Circle,
  allow?: Allow,
  from = RING_INNER * c.r,
  to = RING_OUTER * c.r,
): Spots {
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
    const add = (lo: number, hi: number) => {
      lo = Math.max(0, lo);
      hi = Math.min(e.len, hi);
      if (hi <= lo) return;
      total += hi - lo;
      out.edge.push(edge);
      out.s0.push(lo);
      out.s1.push(hi);
      out.end.push(total);
    };
    const outer = cut(to);
    if (!outer) return;
    const inner = from > 0 ? cut(from) : null;
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

/** What a local's next look does with it: where a stray goes, or one moved anyway. */
const TASK = { ring: 0, disc: 1, rim: 2 } as const;
type Task = (typeof TASK)[keyof typeof TASK];

/**
 * The locals of a crowd of `n`: the movers `ids` keep near a circle. Round the list, each is
 * looked at once per `RECHECK` seconds; one that has strayed farther than `r` (horizontally) from
 * the centre goes to `move`, which puts it on one of the spots it asks for (for the edges it may
 * use) and says whether it could. The spots are the ring of the circle, where the circle creeps
 * on; after a jump of more than `r` (the first look too) the whole circle, so the new place is
 * full at once; and as the circle grows `ZOOM_OUT` times, each local goes, at a chance of the
 * new area's share, to the rim the old circle leaves, so the life thins out evenly. A moved one
 * grows in: its `appear` goes from 0 to 1 over `APPEAR` seconds.
 *
 * The first `capped` of `ids` are no more than the `cap` an update gives: those past it leave the
 * roads (`live` 0) as they are looked at, and come back, put down in the circle, when the cap
 * lets them.
 */
export function createLocals(
  g: RoadGraph,
  n: number,
  ids: number[],
  rand: () => number,
  capped = 0,
) {
  const appear = new Float32Array(n).fill(1);
  const live = new Uint8Array(n).fill(1);
  const task = new Uint8Array(n).fill(TASK.disc);
  let next = 0;
  let due = 0;
  // The circle as the locals last moved all together, its radius the least since.
  let home: Circle | null = null;
  // Where the rim of the last backing off starts, metres from the centre.
  let rim = 0;
  // The spots of the circle they were worked out for, each the first time a local needed them;
  // kept until the circle moves or resizes by more than `RING_MOVE` of it.
  let spotsOf: Circle | null = null;
  let found = new Map<Task, Map<Allow, Spots>>();
  const spotsFor = (kind: Task) => (allow: Allow) => {
    const c = spotsOf!;
    const byAllow = found.get(kind) ?? found.set(kind, new Map()).get(kind)!;
    let s = byAllow.get(allow);
    if (!s) {
      const from = kind === TASK.ring ? RING_INNER * c.r : kind === TASK.rim ? rim : 0;
      byAllow.set(allow, (s = ringSpots(g, c, allow, from)));
    }
    return s;
  };
  const spots = [spotsFor(TASK.ring), spotsFor(TASK.disc), spotsFor(TASK.rim)];

  /** Sets every local's next look for the circle `c`, if it jumped or grew. */
  function follow(c: Circle) {
    if (home && Math.hypot(c.x - home.x, c.z - home.z) <= c.r) {
      if (c.r <= ZOOM_OUT * home.r) {
        home.r = Math.min(home.r, c.r);
        return;
      }
      rim = home.r;
      const stay = (home.r / c.r) ** 2;
      for (const i of ids) if (rand() >= stay) task[i] = TASK.rim;
    } else if (home) {
      for (const i of ids) task[i] = TASK.disc;
    }
    home = { ...c };
  }

  return {
    appear,
    live,
    update(
      dt: number,
      c: Circle | null,
      at: { x: ArrayLike<number>; z: ArrayLike<number> },
      move: (i: number, spots: (allow: Allow) => Spots) => boolean,
      cap = Infinity,
    ) {
      for (let i = 0; i < n; i++) {
        if (appear[i] < 1) appear[i] = Math.min(1, appear[i] + dt / APPEAR);
      }
      if (!c || !ids.length) return;
      follow(c);
      if (drifted(spotsOf, c)) {
        spotsOf = { ...c };
        found = new Map();
      }
      due = Math.min(ids.length, due + (ids.length * dt) / RECHECK);
      for (; due >= 1; due--) {
        const k = next;
        const i = ids[k];
        next = (next + 1) % ids.length;
        if (k < capped && k >= cap) {
          live[i] = 0;
          continue;
        }
        if (!live[i]) {
          if (move(i, spots[TASK.disc])) [live[i], appear[i]] = [1, 0];
          continue;
        }
        const kind = task[i] as Task;
        task[i] = TASK.ring;
        const stray = Math.hypot(at.x[i] - c.x, at.z[i] - c.z) > c.r;
        if ((stray || kind === TASK.rim) && move(i, spots[kind])) appear[i] = 0;
      }
    },
  };
}

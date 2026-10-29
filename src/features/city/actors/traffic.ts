/** Cars driving on lanes and flying cars on air lanes; pure, no three.js. */
import { ROAD, type RoadKind } from "../world/map";
import { pointOn, type RoadEdge, type RoadGraph } from "../world/roads";
import {
  advance,
  createLocals,
  localIds,
  nextEdge,
  place,
  placeOn,
  rng,
  type Allow,
  type Circle,
  type Spots,
  type Track,
} from "./nav";

/** Speeds in m/s. */
export const SPEED = { highway: 22, street: 12, air: 30 };
/** Least centre-to-centre distance to the car ahead, metres. */
export const MIN_GAP = 8;
/** Seconds to cover the free road ahead before the car in front is reached. */
export const HEADWAY = 1;
/** Road length per car, metres, when the city is full. */
export const CAR_SPACING = 30;
/** Heights of the air lanes, metres. */
export const AIR_LANES = [20, 35, 50];
/** Share of the cars that fly. */
export const AIR_SHARE = 0.3;

// How far from the end of its road a car looks at the cars it will follow there, metres.
const LOOK = MIN_GAP + SPEED.highway * HEADWAY;
// ponytail: a longer frame is cut to this, so a car never covers more than the gap it measured.
const MAX_DT = 0.25;
// ponytail: after this many tries a car is put down where it is, even if it is too close.
const PLACE_TRIES = 40;

/** Lanes per direction. */
export function lanes(cls: RoadKind): number {
  if (cls === ROAD.street) return 1;
  return cls === ROAD.lane ? 0 : 2;
}

/** Distance of a lane's centre from the road axis, to the right of the travel, metres. */
export function laneOffset(cls: RoadKind, lane: number): number {
  return cls === ROAD.street ? 1.5 : 2 + 4 * lane;
}

export interface Traffic {
  count: number;
  /** Positions and headings (`atan2(dx, dz)`) of the cars, one slot per car. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  /** 1 for a flying car. */
  air: Uint8Array;
  /** How far a car has grown in after it was moved near the camera, `0…1`. */
  appear: Float32Array;
  /** Drives on `dt` seconds; half the cars keep to `around` (see `createLocals`). */
  update(dt: number, around?: Circle | null): void;
}

const drives = (e: RoadEdge) => lanes(e.cls) > 0;
const flies = (e: RoadEdge) => e.cls === ROAD.highway || e.cls === ROAD.ring;
const speedOn = (cls: RoadKind) => (cls === ROAD.street ? SPEED.street : SPEED.highway);

export function createTraffic(g: RoadGraph, count: number, seed: number): Traffic {
  const rand = rng(seed);
  const room = g.edges.reduce((sum, e) => sum + e.len * 2 * lanes(e.cls), 0);
  const n = Math.max(0, Math.min(Math.floor(count), Math.floor(room / CAR_SPACING)));
  const flying = g.edges.some(flies) ? Math.floor(n * AIR_SHARE) : 0;
  const ground = n - flying; // cars 0..ground-1 drive, the rest fly

  const t: Track = {
    edge: new Int32Array(n),
    s: new Float32Array(n),
    forward: new Uint8Array(n),
  };
  const want = new Uint8Array(n); // the lane a driver prefers; a narrower road squeezes it
  const lane = new Uint8Array(n); // the lane it is in now
  // Where each car goes at the end of its road once it is near it; -1 until chosen.
  const nextE = new Int32Array(n).fill(-1);
  const nextF = new Uint8Array(n);
  const nextL = new Uint8Array(n);
  const locals = createLocals(g, n, [...localIds(0, ground), ...localIds(ground, n - ground)]);
  const out: Traffic = {
    count: n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
    air: new Uint8Array(n),
    appear: locals.appear,
    update,
  };
  out.air.fill(1, ground);

  const laneAt = (i: number, edge: number) => Math.min(want[i], lanes(g.edges[edge].cls) - 1);

  /**
   * Is a car of the first `upTo` within `MIN_GAP` of this spot of this lane (ignoring `skip`),
   * counting the cars that are about to enter the lane as standing before its start?
   */
  function crowded(
    edge: number,
    forward: number,
    ln: number,
    s: number,
    skip: number,
    upTo: number,
  ) {
    for (let j = 0; j < upTo; j++) {
      if (j === skip) continue;
      if (t.edge[j] === edge && t.forward[j] === forward && lane[j] === ln) {
        if (Math.abs(t.s[j] - s) < MIN_GAP) return true;
      } else if (nextE[j] === edge && nextF[j] === forward && nextL[j] === ln) {
        if (s + g.edges[t.edge[j]].len - t.s[j] < MIN_GAP) return true;
      }
    }
    return false;
  }

  function put(i: number) {
    const e = g.edges[t.edge[i]];
    const isAir = i >= ground;
    const off = laneOffset(e.cls, isAir ? 0 : lane[i]);
    const p = pointOn(g, t.edge[i], t.s[i], t.forward[i] === 1, off);
    out.x[i] = p.x;
    if (isAir) out.y[i] = AIR_LANES[(i - ground) % AIR_LANES.length];
    else out.y[i] = p.y; // on the deck of a bridge
    out.z[i] = p.z;
    out.heading[i] = p.heading;
  }

  /**
   * Chooses where car `i` goes at the end of its road, once, as it comes within `LOOK` of it, and
   * keeps the choice until it crosses the node, so the cars behind can see where it will be. It also
   * moves to the lane it will need there (the road ahead may be narrower), as soon as that lane is
   * clear beside it; until then it waits at the node.
   */
  function plan(i: number) {
    const e = g.edges[t.edge[i]];
    if (nextE[i] < 0) {
      if (e.len - t.s[i] >= LOOK) return;
      const node = t.forward[i] === 1 ? e.b : e.a;
      const next = nextEdge(g, node, t.edge[i], rand, drives);
      nextE[i] = next;
      nextF[i] = g.edges[next].a === node ? 1 : 0;
      nextL[i] = Math.min(want[i], lanes(e.cls) - 1, lanes(g.edges[next].cls) - 1);
    }
    if (lane[i] === nextL[i] || crowded(t.edge[i], t.forward[i], nextL[i], t.s[i], i, ground)) {
      return;
    }
    // Beside it the lane is clear; the cars ahead, across the node too, must be as far.
    const was = lane[i];
    lane[i] = nextL[i];
    if (gapAhead(i) < MIN_GAP) lane[i] = was;
  }

  const inNext = (j: number, i: number) =>
    t.edge[j] === nextE[i] && t.forward[j] === nextF[i] && lane[j] === nextL[i];

  /** Component `k` (0: x, 1: z) of the unit vector of travel along an edge. */
  function dir(edge: number, forward: number, k: number): number {
    const e = g.edges[edge];
    const from = forward === 1 ? e.a : e.b;
    const to = forward === 1 ? e.b : e.a;
    return (g.nodes[to * 2 + k] - g.nodes[from * 2 + k]) / (e.len || 1);
  }

  /** Do two lanes of two edges lie on one line: the same heading, less than 2 m apart sideways? */
  function aligned(e1: number, f1: number, l1: number, e2: number, f2: number, l2: number) {
    const o1 = laneOffset(g.edges[e1].cls, l1);
    const o2 = laneOffset(g.edges[e2].cls, l2);
    if (Math.abs(o1 - o2) >= 2) return false;
    return dir(e1, f1, 0) * dir(e2, f2, 0) + dir(e1, f1, 1) * dir(e2, f2, 1) > 0.99;
  }

  const endNode = (edge: number, forward: number) =>
    forward === 1 ? g.edges[edge].b : g.edges[edge].a;

  /**
   * Distance along the way from car `i` to car `j`, if `j` is in front of `i` at the node `i` is
   * coming to, else Infinity. In front: just past the node on the line `i` comes in on (even if `i`
   * turns off) or on the lane `i` goes out on; or coming to the node too and nearer to it, when its
   * line meets the one of `i` (the same lane out, or one continuing the other).
   */
  function crossing(i: number, j: number, node: number): number {
    if (t.edge[j] === t.edge[i] && t.forward[j] === t.forward[i]) return Infinity;
    const left = g.edges[t.edge[i]].len - t.s[i];
    const ej = g.edges[t.edge[j]];
    if ((t.forward[j] === 1 ? ej.a : ej.b) === node) {
      // j has just left the node
      const onMyLine = aligned(t.edge[i], t.forward[i], lane[i], t.edge[j], t.forward[j], lane[j]);
      return onMyLine || inNext(j, i) ? left + t.s[j] : Infinity;
    }
    if (nextE[j] < 0 || endNode(t.edge[j], t.forward[j]) !== node) return Infinity;
    // j is coming to the node too
    const d = left - (ej.len - t.s[j]);
    if (d < 0 || (d === 0 && j < i)) return Infinity;
    const meets =
      (nextE[j] === nextE[i] && nextF[j] === nextF[i] && nextL[j] === nextL[i]) ||
      aligned(t.edge[i], t.forward[i], lane[i], nextE[j], nextF[j], nextL[j]) ||
      aligned(nextE[i], nextF[i], nextL[i], t.edge[j], t.forward[j], lane[j]);
    return meets ? d : Infinity;
  }

  /**
   * Centre-to-centre distance along the way to the nearest car ahead of `i`: on its own lane and
   * across the node it is coming to (see `crossing`).
   */
  // ponytail: every car looks at every other (n² ≤ 150² a frame); sort per lane if it ever shows.
  function gapAhead(i: number): number {
    let gap = Infinity;
    const node = endNode(t.edge[i], t.forward[i]);
    for (let j = 0; j < ground; j++) {
      if (j === i) continue;
      if (t.edge[j] === t.edge[i] && t.forward[j] === t.forward[i] && lane[j] === lane[i]) {
        const d = t.s[j] - t.s[i];
        if (d < gap && (d > 0 || (d === 0 && j > i))) gap = d;
      }
      if (nextE[i] >= 0) gap = Math.min(gap, crossing(i, j, node));
    }
    return gap;
  }

  /** Drives car `i` on by `dist`, into the lane it planned when it passes the node. */
  function drive(i: number, dist: number) {
    const len = g.edges[t.edge[i]].len;
    const s = t.s[i] + dist;
    if (s <= len || nextE[i] < 0 || lane[i] !== nextL[i]) {
      t.s[i] = Math.min(s, len);
      return;
    }
    // ponytail: one node a frame; an edge shorter than the step is crossed over the next frames.
    t.edge[i] = nextE[i];
    t.forward[i] = nextF[i];
    t.s[i] = Math.min(s - len, g.edges[nextE[i]].len);
    nextE[i] = -1;
  }

  function update(dt: number, around: Circle | null = null) {
    const h = Math.min(dt, MAX_DT);
    for (let i = 0; i < ground; i++) plan(i);
    for (let i = 0; i < ground; i++) {
      const free = Math.max(0, (gapAhead(i) - MIN_GAP) / HEADWAY);
      drive(i, Math.min(speedOn(g.edges[t.edge[i]].cls), free) * h);
    }
    for (let i = ground; i < n; i++) advance(g, t, i, SPEED.air * h, rand, flies);
    for (let i = 0; i < n; i++) put(i);
    locals.update(dt, around, out, relocate);
  }

  /** Moves car `i` to a spot of the locals' ring, clear of the others; false if none is. */
  function relocate(i: number, spots: (allow: Allow) => Spots): boolean {
    const isAir = i >= ground;
    const ring = spots(isAir ? flies : drives);
    const was = { edge: t.edge[i], s: t.s[i], forward: t.forward[i], lane: lane[i] };
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      if (!placeOn(g, t, i, ring, rand)) return false;
      if (!isAir) lane[i] = laneAt(i, t.edge[i]);
      put(i);
      if (
        isAir ||
        (!crowded(t.edge[i], t.forward[i], lane[i], t.s[i], i, ground) && !tooClose(i, ground))
      ) {
        nextE[i] = -1;
        return true;
      }
    }
    t.edge[i] = was.edge;
    t.s[i] = was.s;
    t.forward[i] = was.forward;
    lane[i] = was.lane;
    put(i);
    return false;
  }

  /** Is a car of the first `upTo` going the way `i` goes, side by side within 2 m, nearer than `MIN_GAP`? */
  function tooClose(i: number, upTo: number): boolean {
    for (let j = 0; j < upTo; j++) {
      if (j === i) continue;
      const dx = out.x[j] - out.x[i];
      const dz = out.z[j] - out.z[i];
      if (Math.cos(out.heading[j] - out.heading[i]) < 0.99 || Math.hypot(dx, dz) >= MIN_GAP)
        continue;
      if (Math.abs(dx * Math.cos(out.heading[i]) - dz * Math.sin(out.heading[i])) < 2) return true;
    }
    return false;
  }

  for (let i = 0; i < n; i++) {
    const isAir = i >= ground;
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      place(g, t, i, rand, isAir ? flies : drives);
      if (isAir) break;
      want[i] = Math.floor(rand() * 2);
      lane[i] = laneAt(i, t.edge[i]);
      put(i);
      if (!tooClose(i, i)) break;
    }
    put(i);
  }
  return out;
}

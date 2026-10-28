/** Cars driving on lanes and flying cars on air lanes; pure, no three.js. */
import { ROAD, type RoadKind } from "../world/map";
import { pointOn, type RoadEdge, type RoadGraph } from "../world/roads";
import { advance, place, rng, type Track } from "./nav";

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
  update(dt: number): void;
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
  const out: Traffic = {
    count: n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
    air: new Uint8Array(n),
    update,
  };
  out.air.fill(1, ground);

  const laneAt = (i: number, edge: number) => Math.min(want[i], lanes(g.edges[edge].cls) - 1);

  /** Is a car of the first `upTo` within `MIN_GAP` of this spot of this lane (ignoring `skip`)? */
  function crowded(
    edge: number,
    forward: number,
    ln: number,
    s: number,
    skip: number,
    upTo: number,
  ) {
    for (let j = 0; j < upTo; j++) {
      if (j === skip || t.edge[j] !== edge || t.forward[j] !== forward || lane[j] !== ln) continue;
      if (Math.abs(t.s[j] - s) < MIN_GAP) return true;
    }
    return false;
  }

  function put(i: number) {
    const e = g.edges[t.edge[i]];
    const isAir = i >= ground;
    const off = laneOffset(e.cls, isAir ? 0 : lane[i]);
    const p = pointOn(g, t.edge[i], t.s[i], t.forward[i] === 1, off);
    out.x[i] = p.x;
    out.y[i] = isAir ? AIR_LANES[(i - ground) % AIR_LANES.length] : 0;
    out.z[i] = p.z;
    out.heading[i] = p.heading;
  }

  /** Drives car `i` on by `dist`; it waits at the end of its road while the next lane is taken. */
  function drive(i: number, dist: number) {
    const edge = t.edge[i];
    const forward = t.forward[i];
    advance(g, t, i, dist, rand, drives);
    if (t.edge[i] === edge && t.forward[i] === forward) return;
    const ln = laneAt(i, t.edge[i]);
    if (crowded(t.edge[i], t.forward[i], ln, t.s[i], i, ground)) {
      t.edge[i] = edge;
      t.forward[i] = forward;
      t.s[i] = g.edges[edge].len;
    } else {
      lane[i] = ln;
    }
  }

  // ponytail: every car looks at every other (n² ≤ 150² a frame); sort per lane if it ever shows.
  function gapAhead(i: number): number {
    let gap = Infinity;
    for (let j = 0; j < ground; j++) {
      if (t.edge[j] !== t.edge[i] || t.forward[j] !== t.forward[i] || lane[j] !== lane[i]) continue;
      const d = t.s[j] - t.s[i];
      if ((d > 0 || (d === 0 && j > i)) && d < gap) gap = d;
    }
    return gap;
  }

  function update(dt: number) {
    const h = Math.min(dt, MAX_DT);
    for (let i = 0; i < ground; i++) {
      const free = Math.max(0, (gapAhead(i) - MIN_GAP) / HEADWAY);
      drive(i, Math.min(speedOn(g.edges[t.edge[i]].cls), free) * h);
    }
    for (let i = ground; i < n; i++) advance(g, t, i, SPEED.air * h, rand, flies);
    for (let i = 0; i < n; i++) put(i);
  }

  for (let i = 0; i < n; i++) {
    const isAir = i >= ground;
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      place(g, t, i, rand, isAir ? flies : drives);
      if (isAir) break;
      want[i] = Math.floor(rand() * 2);
      lane[i] = laneAt(i, t.edge[i]);
      if (!crowded(t.edge[i], t.forward[i], lane[i], t.s[i], i, i)) break;
    }
    put(i);
  }
  return out;
}

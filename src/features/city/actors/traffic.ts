/** Cars driving on lanes and flying cars on air lanes; pure, no three.js. */
import { ROAD, type RoadKind } from "../world/map";
import { pointOn, type RoadEdge, type RoadGraph } from "../world/roads";
import { createJunctions, lanes, laneOffset, MIN_GAP } from "./junctions";
import { createLocals, localIds, placeOn, type Circle, type Spots } from "./locals";
import { advance, nextEdge, place, rng, type Allow, type Track } from "./nav";

/** Speeds in m/s. */
export const SPEED = { highway: 22, street: 12, air: 30 };
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
/** Seconds a car waits at a node for the lane it wants before it gives the wish up. */
export const STUCK = 1;

/** Where a ground car starts, instead of a random spot: `lane` it is in, `want` it prefers. */
export interface CarStart {
  edge: number;
  s: number;
  forward: boolean;
  lane: number;
  want: number;
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
  /** Drives on `dt` seconds; the cars keep to `around` (see `createLocals`). */
  update(dt: number, around?: Circle | null): void;
}

const drives = (e: RoadEdge) => lanes(e.cls) > 0;
const flies = (e: RoadEdge) => e.cls === ROAD.highway || e.cls === ROAD.ring;
const speedOn = (cls: RoadKind) => (cls === ROAD.street ? SPEED.street : SPEED.highway);

/** `start` puts the first ground cars down where it says. */
export function createTraffic(
  g: RoadGraph,
  count: number,
  seed: number,
  start: readonly CarStart[] = [],
): Traffic {
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
  const held = new Float32Array(n); // seconds standing at the node, the lane it wants not free
  // When each car chose its way at the node ahead, on the traffic's clock, and its turn there.
  const since = new Float64Array(n);
  const turn = new Float64Array(n);
  let clock = 0;
  const locals = createLocals(
    g,
    n,
    [...localIds(0, ground), ...localIds(ground, n - ground)],
    rand,
  );
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
  const { crowded, endNode, gapAhead, takeTurns } = createJunctions({
    g,
    t,
    lane,
    nextE,
    nextF,
    nextL,
    since,
    turn,
    ground,
  });

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
      since[i] = clock;
      nextL[i] = Math.min(want[i], lanes(e.cls) - 1, lanes(g.edges[next].cls) - 1);
    }
    if (held[i] > STUCK) giveUp(i);
    if (lane[i] === nextL[i] || crowded(t.edge[i], t.forward[i], nextL[i], t.s[i], i)) {
      return;
    }
    // Beside it the lane is clear; the cars ahead, across the node too, must be as far.
    const was = lane[i];
    lane[i] = nextL[i];
    if (gapAhead(i) < MIN_GAP) lane[i] = was;
  }

  /**
   * Car `i` has stood at its node too long for the lane it wants, whose cars wait for its own
   * lane as often as not: it keeps to its lane, out of the node by another road if the one it
   * chose has no such lane. With no such road it waits on.
   */
  function giveUp(i: number) {
    held[i] = 0;
    if (lane[i] < lanes(g.edges[nextE[i]].cls)) {
      nextL[i] = lane[i];
      return;
    }
    const node = endNode(t.edge[i], t.forward[i]);
    const other = nextEdge(g, node, t.edge[i], rand, (e) => lanes(e.cls) > lane[i]);
    if (other === t.edge[i]) return; // only the way back
    nextE[i] = other;
    nextF[i] = g.edges[other].a === node ? 1 : 0;
    nextL[i] = lane[i];
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
    clock += h;
    for (let i = 0; i < ground; i++) plan(i);
    takeTurns();
    for (let i = 0; i < ground; i++) {
      const free = Math.max(0, (gapAhead(i) - MIN_GAP) / HEADWAY);
      drive(i, Math.min(speedOn(g.edges[t.edge[i]].cls), free) * h);
      const atNode = t.s[i] >= g.edges[t.edge[i]].len && nextE[i] >= 0;
      held[i] = atNode && lane[i] !== nextL[i] ? held[i] + h : 0;
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
        (!crowded(t.edge[i], t.forward[i], lane[i], t.s[i], i) && !tooClose(i, ground))
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
    const at = isAir ? undefined : start[i];
    if (at) {
      [t.edge[i], t.s[i], t.forward[i]] = [at.edge, at.s, at.forward ? 1 : 0];
      [lane[i], want[i]] = [at.lane, at.want];
      put(i);
      continue;
    }
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

/** Cars driving on lanes and flying cars on air lanes; pure, no three.js. */
import { ROAD, type RoadKind } from "../world/map";
import { pointOn, type RoadEdge, type RoadGraph } from "../world/roads";
import { createPoses } from "./carPose";
import { createJunctions, lanes, MIN_GAP } from "./junctions";
import {
  createLocals,
  drifted,
  localIds,
  placeOn,
  ringSpots,
  type Circle,
  type Spots,
} from "./locals";
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
/** Seconds a car stands at a node, whatever holds it, before it looks for another way out. */
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
  /** 0 for a car off the roads: more than the roads near the camera hold. Not drawn. */
  live: Uint8Array;
  /**
   * Drives on `dt` seconds; the cars keep to `around` (see `createLocals`), no more ground cars
   * on its roads than one per `CAR_SPACING` of their lanes.
   */
  update(dt: number, around?: Circle | null): void;
}

/** The edges ground cars drive on. */
export const drives = (e: RoadEdge) => lanes(e.cls) > 0;
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
  const held = new Float32Array(n); // seconds standing at the node ahead
  // When each car chose its way at the node ahead, on the traffic's clock, and its turn there.
  const since = new Float64Array(n);
  const turn = new Float64Array(n);
  let clock = 0;
  const drivers = localIds(0, ground);
  const locals = createLocals(
    g,
    n,
    [...drivers, ...localIds(ground, n - ground)],
    rand,
    drivers.length,
  );
  const out: Traffic = {
    count: n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
    air: new Uint8Array(n),
    appear: locals.appear,
    live: locals.live,
    update,
  };
  out.air.fill(1, ground);

  const laneAt = (i: number, edge: number) => Math.min(want[i], lanes(g.edges[edge].cls) - 1);
  const { crowded, cutsIn, endNode, gapAhead, takeTurns, turnOf } = createJunctions({
    g,
    t,
    lane,
    nextE,
    nextF,
    nextL,
    since,
    turn,
    live: locals.live,
    ground,
  });
  const live = locals.live;
  const poses = createPoses(g, t, lane, nextE, nextF);
  const spot = { x: 0, y: 0, z: 0, heading: 0 };

  function put(i: number) {
    if (i < ground) return poses.put(i, out);
    const p = pointOn(g, t.edge[i], t.s[i], t.forward[i] === 1, 0, spot);
    out.x[i] = p.x;
    out.y[i] = AIR_LANES[(i - ground) % AIR_LANES.length];
    out.z[i] = p.z;
    out.heading[i] = p.heading;
  }

  /** Puts car `i` down where its track says, drawn on its lane. */
  function putNew(i: number) {
    poses.reset(i);
    put(i);
  }

  /**
   * Chooses where car `i` goes at the end of its road, once, as it comes within `LOOK` of it, and
   * keeps the choice until it crosses the node, so the cars behind can see where it will be. It also
   * moves to the lane it will need there (the road ahead may be narrower), as soon as that lane is
   * clear beside it; until then it waits at the node, at most `STUCK` seconds (see `rethink`).
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
    if (held[i] > STUCK) rethink(i);
    if (lane[i] === nextL[i] || crowded(t.edge[i], t.forward[i], nextL[i], t.s[i], i)) {
      return;
    }
    // Beside it the lane is clear; the cars ahead, across the node too, must be as far. It comes
    // to the node anew in that lane, last in the turns but for the cars queued behind it there.
    const was = [lane[i], since[i], turn[i]];
    [lane[i], since[i]] = [nextL[i], clock];
    turn[i] = turnOf(i);
    if (gapAhead(i) < MIN_GAP || cutsIn(i)) [lane[i], since[i], turn[i]] = was;
  }

  /**
   * Car `i` has stood at its node longer than `STUCK`, whatever held it: the lane it wants taken
   * beside it, no room past the node, a car it lets go first. It takes a way out that is free now,
   * in the lane it is in, at random among them; with none it waits and looks again. A ring of
   * full roads that waits for itself would need far more cars than the cap lets onto them.
   */
  function rethink(i: number) {
    held[i] = 0;
    const node = endNode(t.edge[i], t.forward[i]);
    const was = [nextE[i], nextF[i], nextL[i]];
    const choose = (e: number) => {
      [nextE[i], nextF[i], nextL[i]] = [e, g.edges[e].a === node ? 1 : 0, lane[i]];
    };
    const exits = g.links[node];
    const free = exits.filter((e) => {
      if ((e === t.edge[i] && exits.length > 1) || lanes(g.edges[e].cls) <= lane[i]) return false;
      choose(e);
      return gapAhead(i) >= MIN_GAP;
    });
    if (free.length) choose(free[Math.floor(rand() * free.length)]);
    else [nextE[i], nextF[i], nextL[i]] = was;
  }

  // How many ground cars the roads of the locals' circle hold, one per `CAR_SPACING` of their
  // lanes; worked out again as the circle drifts.
  let roomOf: Circle | null = null;
  let roomFor = Infinity;
  function capOf(c: Circle | null): number {
    if (!c) return Infinity;
    if (drifted(roomOf, c)) {
      roomOf = { ...c };
      const disc = ringSpots(g, c, drives, 0, c.r);
      let metres = 0;
      disc.edge.forEach((e, k) => {
        metres += (disc.s1[k] - disc.s0[k]) * 2 * lanes(g.edges[e].cls);
      });
      roomFor = Math.floor(metres / CAR_SPACING);
    }
    return roomFor;
  }

  /** Drives car `i` on by `dist`, into the lane it planned when it passes the node; the metres it moved. */
  function drive(i: number, dist: number): number {
    const len = g.edges[t.edge[i]].len;
    const s = t.s[i] + dist;
    if (s <= len || nextE[i] < 0 || lane[i] !== nextL[i]) {
      const was = t.s[i];
      t.s[i] = Math.min(s, len);
      return t.s[i] - was;
    }
    poses.crossing(i);
    // ponytail: one node a frame; an edge shorter than the step is crossed over the next frames.
    t.edge[i] = nextE[i];
    t.forward[i] = nextF[i];
    t.s[i] = Math.min(s - len, g.edges[nextE[i]].len);
    nextE[i] = -1;
    return dist;
  }

  function update(dt: number, around: Circle | null = null) {
    const h = Math.min(dt, MAX_DT);
    clock += h;
    for (let i = 0; i < ground; i++) if (live[i]) plan(i);
    takeTurns();
    for (let i = 0; i < ground; i++) {
      if (!live[i]) continue;
      const free = Math.max(0, (gapAhead(i) - MIN_GAP) / HEADWAY);
      poses.ease(i, h, drive(i, Math.min(speedOn(g.edges[t.edge[i]].cls), free) * h));
      const atNode = t.s[i] >= g.edges[t.edge[i]].len && nextE[i] >= 0;
      held[i] = atNode ? held[i] + h : 0;
    }
    for (let i = ground; i < n; i++) advance(g, t, i, SPEED.air * h, rand, flies);
    for (let i = 0; i < n; i++) if (live[i]) put(i);
    locals.update(dt, around, out, relocate, capOf(around));
  }

  /**
   * Moves car `i` to one of the locals' spots, with no car within `CAR_SPACING` on its lane and
   * none beside it; false if there is no such spot.
   */
  function relocate(i: number, spots: (allow: Allow) => Spots): boolean {
    const isAir = i >= ground;
    const ring = spots(isAir ? flies : drives);
    const was = {
      edge: t.edge[i],
      s: t.s[i],
      forward: t.forward[i],
      lane: lane[i],
      next: nextE[i],
    };
    nextE[i] = -1; // no curve to its old way out is drawn at a new spot
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      if (!placeOn(g, t, i, ring, rand)) break;
      if (!isAir) lane[i] = laneAt(i, t.edge[i]);
      putNew(i);
      if (
        isAir ||
        (!crowded(t.edge[i], t.forward[i], lane[i], t.s[i], i, CAR_SPACING) && !tooClose(i, ground))
      ) {
        held[i] = 0;
        return true;
      }
    }
    t.edge[i] = was.edge;
    t.s[i] = was.s;
    t.forward[i] = was.forward;
    lane[i] = was.lane;
    nextE[i] = was.next;
    putNew(i);
    return false;
  }

  /** Is a car of the first `upTo` going the way `i` goes, side by side within 2 m, nearer than `MIN_GAP`? */
  function tooClose(i: number, upTo: number): boolean {
    for (let j = 0; j < upTo; j++) {
      if (j === i || !live[j]) continue;
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
      putNew(i);
      continue;
    }
    for (let tries = 0; tries < PLACE_TRIES; tries++) {
      place(g, t, i, rand, isAir ? flies : drives);
      if (isAir) break;
      want[i] = Math.floor(rand() * 2);
      lane[i] = laneAt(i, t.edge[i]);
      putNew(i);
      if (!tooClose(i, i)) break;
    }
    putNew(i);
  }
  return out;
}

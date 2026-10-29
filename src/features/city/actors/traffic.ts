/** Cars driving on lanes and flying cars on air lanes; pure, no three.js. */
import { ROAD, type RoadKind } from "../world/map";
import { pointOn, type RoadGraph } from "../world/roads";
import { CAR_SPACING, createPlacement, drives, flies, type CarStart } from "./carPlace";
import { createPoses } from "./carPose";
import { createJunctions, laneOffset, lanes, MIN_GAP } from "./junctions";
import { createLocals, localIds, type Circle } from "./locals";
import { advance, nextEdge, rng, type Track } from "./nav";

export { CAR_SPACING, drives, type CarStart };

/** Speeds in m/s. */
export const SPEED = { highway: 22, street: 12, air: 30 };
/** Seconds to cover the free road ahead before the car in front is reached. */
export const HEADWAY = 1;
/** Heights of the air lanes, metres. */
export const AIR_LANES = [20, 35, 50];
/** Share of the cars that fly. */
export const AIR_SHARE = 0.3;

// How far from the end of its road a car looks at the cars it will follow there, metres.
const LOOK = MIN_GAP + SPEED.highway * HEADWAY;
// ponytail: a longer frame is cut to this, so a car never covers more than the gap it measured.
const MAX_DT = 0.25;
// A car moving across to another lane holds the one it left until it is drawn this near the new one, metres.
const ACROSS = 0.5;
/**
 * Seconds a car stands with its way out of the node ahead chosen, at the node or short of it,
 * whatever holds it, before it looks for another way out.
 */
export const STUCK = 1;

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
  // The offset of the lane a car is moving across from, while it is drawn in it too; else NaN.
  const leaving = new Float32Array(n).fill(NaN);
  // Where each car goes at the end of its road once it is near it; -1 until chosen.
  const nextE = new Int32Array(n).fill(-1);
  const nextF = new Uint8Array(n);
  const nextL = new Uint8Array(n);
  const held = new Float32Array(n); // seconds standing still with its way out chosen
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

  const { crowded, cutsIn, endNode, gapAhead, takeTurns, turnOf } = createJunctions({
    g,
    t,
    lane,
    leaving,
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
    leaving[i] = NaN;
    poses.reset(i);
    put(i);
  }

  const { capOf, relocate, placeAll } = createPlacement({
    g,
    t,
    lane,
    want,
    nextE,
    held,
    live,
    out,
    rand,
    ground,
    crowded,
    putNew,
  });

  /**
   * Chooses where car `i` goes at the end of its road, once, as it comes within `LOOK` of it, and
   * keeps the choice until it crosses the node, so the cars behind can see where it will be. It also
   * moves to the lane it will need there (the road ahead may be narrower), as soon as that lane is
   * clear beside it; until then it waits, at most `STUCK` seconds once it stands (see `rethink`).
   * Until it is drawn across, it holds the lane it left too (see `ACROSS`).
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
    // Beside it the lane is clear; the cars ahead, across the node too, must be as far. It keeps
    // its turn there, as it chose its way when it came near; `cutsIn` keeps it from taking that
    // turn under the nose of a car coming to the node.
    const wasLane = lane[i];
    const wasTurn = turn[i];
    lane[i] = nextL[i];
    turn[i] = turnOf(i);
    if (gapAhead(i) < MIN_GAP || cutsIn(i)) {
      lane[i] = wasLane;
      turn[i] = wasTurn;
    } else leaving[i] = laneOffset(e.cls, wasLane);
  }

  // The free ways out `rethink` finds, as many as a node has at most.
  const freeExits = new Int32Array(g.links.reduce((most, l) => Math.max(most, l.length), 0));

  /** Car `i` is to leave its node by `e`, in the lane it is in. */
  function choose(i: number, node: number, e: number) {
    nextE[i] = e;
    nextF[i] = g.edges[e].a === node ? 1 : 0;
    nextL[i] = lane[i];
  }

  /**
   * Car `i` has stood longer than `STUCK` with its way out chosen, at its node or short of it,
   * whatever held it: the lane it wants taken beside it, no room past the node, a car it lets go
   * first. It takes a way out that is free now, in the lane it is in, at random among them; with
   * none it waits and looks again. A ring of full roads that waits for itself would need far more
   * cars than the cap lets onto them.
   */
  function rethink(i: number) {
    held[i] = 0;
    const node = endNode(t.edge[i], t.forward[i]);
    const wasE = nextE[i];
    const wasF = nextF[i];
    const wasL = nextL[i];
    const exits = g.links[node];
    let free = 0;
    for (let k = 0; k < exits.length; k++) {
      const e = exits[k];
      if ((e === t.edge[i] && exits.length > 1) || lanes(g.edges[e].cls) <= lane[i]) continue;
      choose(i, node, e);
      if (gapAhead(i) >= MIN_GAP) freeExits[free++] = e;
    }
    if (free) choose(i, node, freeExits[Math.floor(rand() * free)]);
    else {
      nextE[i] = wasE;
      nextF[i] = wasF;
      nextL[i] = wasL;
    }
  }

  /**
   * Drives car `i` on by `dist`, into the lane it planned when it passes the node; the metres it
   * moved. A car still moving across holds the lane it left on the road past the node too.
   */
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
      const moved = drive(i, Math.min(speedOn(g.edges[t.edge[i]].cls), free) * h);
      if (poses.ease(i, h, moved) <= ACROSS) leaving[i] = NaN;
      held[i] = nextE[i] >= 0 && moved === 0 ? held[i] + h : 0;
    }
    for (let i = ground; i < n; i++) advance(g, t, i, SPEED.air * h, rand, flies);
    for (let i = 0; i < n; i++) if (live[i]) put(i);
    locals.update(dt, around, out, relocate, capOf(around));
  }

  placeAll(start);
  return out;
}

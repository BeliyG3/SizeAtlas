/**
 * The right of way of the cars: the lanes of the roads, the gap to the car in front on a lane
 * and across the node ahead, and who goes first there; pure, no three.js.
 */
import { HEADROOM } from "../physics/bodies";
import { ROAD, type RoadKind } from "../world/map";
import type { RoadGraph } from "../world/roads";
import type { Track } from "./nav";

/** Least centre-to-centre distance to the car ahead, metres. */
export const MIN_GAP = 8;

/**
 * What the ground cars stop short of on their lanes, besides each other (the player and its
 * cars): the first `count` points, each at its feet's height `y`, `r` metres wide.
 */
export interface Obstacles {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  r: Float64Array;
}

/** Half a car's width: an obstacle this much plus its radius off a lane's centre is in it, metres. */
const HALF_WIDE = 0.9;
/** An obstacle this far behind a car's centre is under its body: it holds the car too, metres. */
const HALF_LONG = 2.1;

/** Lanes per direction. */
export function lanes(cls: RoadKind): number {
  if (cls === ROAD.street) return 1;
  return cls === ROAD.lane ? 0 : 2;
}

/** Distance of a lane's centre from the road axis, to the right of the travel, metres. */
export function laneOffset(cls: RoadKind, lane: number): number {
  return cls === ROAD.street ? 1.5 : 2 + 4 * lane;
}

/** The ground cars as the junctions see them; the traffic owns and changes these arrays. */
export interface Lanes {
  g: RoadGraph;
  t: Track;
  /** The lane each car is in. */
  lane: Uint8Array;
  /**
   * The offset (see `laneOffset`) of the lane a car is moving across from, NaN once it is over:
   * till then it holds that lane too, past a node as well, so no car drives through it.
   */
  leaving: Float32Array;
  /** Where each car goes at the end of its road once it is near it; -1 until chosen. */
  nextE: Int32Array;
  nextF: Uint8Array;
  nextL: Uint8Array;
  /** When each car chose its way at the node ahead, on the traffic's clock. */
  since: Float64Array;
  /** Its turn there: see `takeTurns`. */
  turn: Float64Array;
  /** 0 for a car off the roads: it holds no place on them. */
  live: Uint8Array;
  /** Cars `0 … ground - 1` drive; the others fly and take no part. */
  ground: number;
}

export function createJunctions(s: Lanes) {
  const { g, t, lane, leaving, nextE, nextF, nextL, since, turn, live, ground } = s;
  /** Does car `j` hold lane `ln` of a road of class `cls`: is it in it, or moving out of it? */
  const holds = (j: number, cls: RoadKind, ln: number) =>
    lane[j] === ln || Math.abs(leaving[j] - laneOffset(cls, ln)) < 1e-3;

  /**
   * Is a car (but `skip`) within `gap` of this spot of this lane, counting the cars that are
   * about to enter the lane as standing before its start?
   */
  function crowded(
    edge: number,
    forward: number,
    ln: number,
    at: number,
    skip: number,
    gap = MIN_GAP,
  ) {
    for (let j = 0; j < ground; j++) {
      if (j === skip || !live[j]) continue;
      if (t.edge[j] === edge && t.forward[j] === forward && holds(j, g.edges[edge].cls, ln)) {
        if (Math.abs(t.s[j] - at) < gap) return true;
      } else if (nextE[j] === edge && nextF[j] === forward && nextL[j] === ln) {
        if (at + g.edges[t.edge[j]].len - t.s[j] < gap) return true;
      }
    }
    return false;
  }

  const inNext = (j: number, i: number) =>
    t.edge[j] === nextE[i] &&
    t.forward[j] === nextF[i] &&
    holds(j, g.edges[nextE[i]].cls, nextL[i]);

  /** Component `k` (0: x, 1: z) of the unit vector of travel along an edge. */
  function dir(edge: number, forward: number, k: number): number {
    const e = g.edges[edge];
    const from = forward === 1 ? e.a : e.b;
    const to = forward === 1 ? e.b : e.a;
    return (g.nodes[to * 2 + k] - g.nodes[from * 2 + k]) / (e.len || 1);
  }

  /** Do two lanes of two edges lie on one line: the same heading, less than 2 m apart sideways? */
  function aligned(e1: number, f1: number, l1: number, e2: number, f2: number, l2: number) {
    return lined(e1, f1, laneOffset(g.edges[e1].cls, l1), e2, f2, laneOffset(g.edges[e2].cls, l2));
  }

  /** `aligned`, for the lanes at offsets `o1` and `o2` (see `laneOffset`). */
  function lined(e1: number, f1: number, o1: number, e2: number, f2: number, o2: number) {
    if (!(Math.abs(o1 - o2) < 2)) return false;
    return dir(e1, f1, 0) * dir(e2, f2, 0) + dir(e1, f1, 1) * dir(e2, f2, 1) > 0.99;
  }

  const endNode = (edge: number, forward: number) =>
    forward === 1 ? g.edges[edge].b : g.edges[edge].a;

  let seen: Obstacles | null = null;
  /** The obstacles the cars see from now on; null: none. */
  const sees = (o: Obstacles | null) => {
    seen = o;
  };

  /**
   * How far along `edge` (travelled `forward`) from its start the nearest obstacle in lane `ln` is,
   * no nearer than `from`, near the height `y`; Infinity for none.
   */
  function obstacleOn(edge: number, forward: number, ln: number, y: number, from: number) {
    const o = seen!;
    const e = g.edges[edge];
    const start = forward === 1 ? e.a : e.b;
    const ux = dir(edge, forward, 0);
    const uz = dir(edge, forward, 1);
    const off = laneOffset(e.cls, ln);
    let best = Infinity;
    for (let k = 0; k < o.count; k++) {
      if (Math.abs(o.y[k] - y) >= HEADROOM) continue;
      const wx = o.x[k] - g.nodes[start * 2];
      const wz = o.z[k] - g.nodes[start * 2 + 1];
      const along = wx * ux + wz * uz;
      if (along < from || along > e.len || along >= best) continue;
      // To the right of the travel, as `laneOffset` measures.
      if (Math.abs(wz * ux - wx * uz - off) < HALF_WIDE + o.r[k]) best = along;
    }
    return best;
  }

  /** The nearest obstacle ahead of car `i` on its lane, and past its node on the lane it chose. */
  function obstacleAhead(i: number): number {
    const e = g.edges[t.edge[i]];
    const s = t.s[i];
    const k = s / (e.len || 1);
    const y =
      t.forward[i] === 1 ? e.liftA + (e.liftB - e.liftA) * k : e.liftB + (e.liftA - e.liftB) * k;
    const gap = obstacleOn(t.edge[i], t.forward[i], lane[i], y, s - HALF_LONG) - s;
    if (nextE[i] < 0) return gap;
    return Math.min(gap, e.len - s + obstacleOn(nextE[i], nextF[i], nextL[i], y, 0));
  }

  /** Is an obstacle within `d` metres of (x, z)? */
  function nearObstacle(x: number, z: number, d: number): boolean {
    const o = seen;
    for (let k = 0; o && k < o.count; k++) if (Math.hypot(o.x[k] - x, o.z[k] - z) < d) return true;
    return false;
  }

  /**
   * Distance along the way from car `i` to car `j`, if `j` is in front of `i` at the node `i` is
   * coming to, else Infinity. In front: just past the node on the line `i` comes in on (even if `i`
   * turns off) or on the lane `i` goes out on; or coming to the node too, in the lane it leaves
   * by, having chosen its way there first (its `turn`; at the same turn the nearer one), when its
   * line meets the one of `i` (the same lane out, or one continuing the other). Then the distance
   * is how much nearer to the node `j` is, below zero if it is farther: `i` waits until `j` is
   * through. First come, first served: a car that stopped as it came near the node keeps its
   * turn, where "the nearer goes first" let every newcomer pass it for ever. A car still to
   * change lanes cannot go yet: waiting for it could close a ring through the car beside it.
   */
  function crossing(i: number, j: number, node: number): number {
    if (t.edge[j] === t.edge[i] && t.forward[j] === t.forward[i]) return Infinity;
    const left = g.edges[t.edge[i]].len - t.s[i];
    const ej = g.edges[t.edge[j]];
    if ((t.forward[j] === 1 ? ej.a : ej.b) === node) {
      // j has just left the node
      const mine = laneOffset(g.edges[t.edge[i]].cls, lane[i]);
      const onMyLine =
        aligned(t.edge[i], t.forward[i], lane[i], t.edge[j], t.forward[j], lane[j]) ||
        lined(t.edge[i], t.forward[i], mine, t.edge[j], t.forward[j], leaving[j]);
      return onMyLine || inNext(j, i) ? left + t.s[j] : Infinity;
    }
    if (nextE[j] < 0 || endNode(t.edge[j], t.forward[j]) !== node) return Infinity;
    // j is coming to the node too
    if (lane[j] !== nextL[j]) return Infinity;
    const d = left - (ej.len - t.s[j]);
    if (turn[j] > turn[i] || (turn[j] === turn[i] && (d < 0 || (d === 0 && j < i)))) {
      return Infinity;
    }
    const meets =
      (nextE[j] === nextE[i] && nextF[j] === nextF[i] && nextL[j] === nextL[i]) ||
      aligned(t.edge[i], t.forward[i], lane[i], nextE[j], nextF[j], nextL[j]) ||
      aligned(nextE[i], nextF[i], nextL[i], t.edge[j], t.forward[j], lane[j]);
    return meets ? d : Infinity;
  }

  /**
   * Centre-to-centre distance along the way to the nearest car ahead of `i`: on its own lane and
   * across the node it is coming to (see `crossing`); or to an obstacle on its lane, here or past
   * the node (below zero for one under its body).
   */
  // ponytail: every car looks at every other (n² ≤ 150² a frame); sort per lane if it ever shows.
  function gapAhead(i: number): number {
    let gap = Infinity;
    const node = endNode(t.edge[i], t.forward[i]);
    for (let j = 0; j < ground; j++) {
      if (j === i || !live[j]) continue;
      const sameWay = t.edge[j] === t.edge[i] && t.forward[j] === t.forward[i];
      if (sameWay && holds(j, g.edges[t.edge[i]].cls, lane[i])) {
        const d = t.s[j] - t.s[i];
        if (d < gap && (d > 0 || (d === 0 && j > i))) gap = d;
      }
      if (nextE[i] >= 0) gap = Math.min(gap, crossing(i, j, node));
    }
    return seen?.count ? Math.min(gap, obstacleAhead(i)) : gap;
  }

  /**
   * The turn of each car at its node: the earliest choice of its lane from it back, so a car
   * never has the turn over one queued in front of it. A wait for a car coming to the node is
   * then for one earlier in one order (turn, then nearness), never round a ring; the waits for
   * room past the node are the traffic's to break (`STUCK`).
   */
  function takeTurns() {
    for (let i = 0; i < ground; i++) turn[i] = turnOf(i);
  }

  /** The turn of car `i` as it stands now (see `takeTurns`). */
  function turnOf(i: number): number {
    if (nextE[i] < 0 || !live[i]) return Infinity;
    let first = since[i];
    for (let j = 0; j < ground; j++) {
      const behind = t.s[j] < t.s[i] || (t.s[j] === t.s[i] && j < i);
      const queue = t.edge[j] === t.edge[i] && t.forward[j] === t.forward[i] && lane[j] === lane[i];
      if (queue && behind && nextE[j] >= 0 && live[j]) first = Math.min(first, since[j]);
    }
    return first;
  }

  /**
   * Would a car coming to the node of `j` have to wait for `j`, as it stands now, nearer than
   * `MIN_GAP`? A car that has just changed lanes must not cut in like that: while it waited to
   * change, nobody waited for it.
   */
  function cutsIn(j: number): boolean {
    const node = endNode(t.edge[j], t.forward[j]);
    for (let i = 0; i < ground; i++) {
      if (i === j || !live[i] || nextE[i] < 0 || endNode(t.edge[i], t.forward[i]) !== node)
        continue;
      if (crossing(i, j, node) < MIN_GAP) return true;
    }
    return false;
  }

  return { crowded, cutsIn, endNode, gapAhead, nearObstacle, sees, takeTurns, turnOf };
}

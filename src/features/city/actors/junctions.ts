/**
 * The right of way of the cars: the lanes of the roads, the gap to the car in front on a lane
 * and across the node ahead, and who goes first there; pure, no three.js.
 */
import { ROAD, type RoadKind } from "../world/map";
import type { RoadGraph } from "../world/roads";
import type { Track } from "./nav";

/** Least centre-to-centre distance to the car ahead, metres. */
export const MIN_GAP = 8;

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
  /** Where each car goes at the end of its road once it is near it; -1 until chosen. */
  nextE: Int32Array;
  nextF: Uint8Array;
  nextL: Uint8Array;
  /** When each car chose its way at the node ahead, on the traffic's clock. */
  since: Float64Array;
  /** Its turn there: see `takeTurns`. */
  turn: Float64Array;
  /** Cars `0 … ground - 1` drive; the others fly and take no part. */
  ground: number;
}

export function createJunctions(s: Lanes) {
  const { g, t, lane, nextE, nextF, nextL, since, turn, ground } = s;

  /**
   * Is a car (but `skip`) within `MIN_GAP` of this spot of this lane, counting the cars that are
   * about to enter the lane as standing before its start?
   */
  function crowded(edge: number, forward: number, ln: number, at: number, skip: number) {
    for (let j = 0; j < ground; j++) {
      if (j === skip) continue;
      if (t.edge[j] === edge && t.forward[j] === forward && lane[j] === ln) {
        if (Math.abs(t.s[j] - at) < MIN_GAP) return true;
      } else if (nextE[j] === edge && nextF[j] === forward && nextL[j] === ln) {
        if (at + g.edges[t.edge[j]].len - t.s[j] < MIN_GAP) return true;
      }
    }
    return false;
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
   * turns off) or on the lane `i` goes out on; or coming to the node too, having chosen its way
   * there first (its `turn`; at the same turn the nearer one), when its line meets the one of `i`
   * (the same lane out, or one continuing the other). Then the distance is how much nearer to the
   * node `j` is, below zero if it is farther: `i` waits until `j` is through. First come, first
   * served: a car that stopped as it came near the node keeps its turn, where "the nearer goes
   * first" let every newcomer pass it for ever.
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

  /**
   * The turn of each car at its node: the earliest choice of its lane from it back, so a car
   * never has the turn over one queued in front of it. Every wait at a node is then for a car
   * earlier in one order (turn, then nearness), and no ring of cars can wait on each other.
   */
  function takeTurns() {
    for (let i = 0; i < ground; i++) turn[i] = nextE[i] >= 0 ? since[i] : Infinity;
    for (let i = 0; i < ground; i++) {
      if (nextE[i] < 0) continue;
      for (let j = 0; j < ground; j++) {
        const behind = t.s[j] < t.s[i] || (t.s[j] === t.s[i] && j < i);
        const queue =
          t.edge[j] === t.edge[i] && t.forward[j] === t.forward[i] && lane[j] === lane[i];
        if (queue && behind && nextE[j] >= 0) turn[i] = Math.min(turn[i], since[j]);
      }
    }
  }

  return { crowded, endNode, gapAhead, takeTurns };
}

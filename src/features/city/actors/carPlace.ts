/**
 * Where the cars are put down: all of them at the start, and one at a time near the camera,
 * no nearer the others than the lanes allow; pure, no three.js.
 */
import { ROAD } from "../world/map";
import type { RoadEdge, RoadGraph } from "../world/roads";
import type { Drawn } from "./carPose";
import { lanes, MIN_GAP, type createJunctions } from "./junctions";
import { drifted, placeOn, ringSpots, type Circle, type Spots } from "./locals";
import { place, type Allow, type Track } from "./nav";

/** Road length per car, metres, when the city is full. */
export const CAR_SPACING = 30;
// ponytail: after this many tries a car is put down where it is, even if it is too close.
const PLACE_TRIES = 40;

/** The edges ground cars drive on. */
export const drives = (e: RoadEdge) => lanes(e.cls) > 0;
/** The edges flying cars fly over. */
export const flies = (e: RoadEdge) => e.cls === ROAD.highway || e.cls === ROAD.ring;

/** Where a ground car starts, instead of a random spot: `lane` it is in, `want` it prefers. */
export interface CarStart {
  edge: number;
  s: number;
  forward: boolean;
  lane: number;
  want: number;
}

/** The traffic's cars; it owns these arrays, the placing changes them as it puts a car down. */
export interface Placing {
  g: RoadGraph;
  t: Track;
  lane: Uint8Array;
  want: Uint8Array;
  nextE: Int32Array;
  held: Float32Array;
  live: Uint8Array;
  out: Drawn;
  rand: () => number;
  /** Cars `0 … ground - 1` drive, the others fly. */
  ground: number;
  crowded: ReturnType<typeof createJunctions>["crowded"];
  /** Draws car `i` where its track says, on its lane, off any curve. */
  putNew: (i: number) => void;
}

export function createPlacement(p: Placing) {
  const { g, t, lane, want, nextE, held, live, out, rand, ground, crowded, putNew } = p;
  const n = lane.length;
  const laneAt = (i: number, edge: number) => Math.min(want[i], lanes(g.edges[edge].cls) - 1);

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

  /** Puts every car down: the first ground cars where `start` says, the others at random. */
  function placeAll(start: readonly CarStart[]) {
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
  }

  return { capOf, relocate, placeAll };
}

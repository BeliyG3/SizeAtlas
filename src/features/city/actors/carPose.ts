/**
 * Where a ground car is drawn: on its lane, on a curve through the node it turns at, easing
 * across to another lane, swinging round to a new way out; the driving reads only how far a car
 * is still drawn off its lane, and whether it is still swinging round. Pure, no three.js.
 */
import { pointOn, type RoadGraph } from "../world/roads";
import { cornerAt, reach, type Pose } from "./corners";
import { laneOffset } from "./junctions";
import type { Track } from "./nav";

/** How fast a car is drawn moving across to another lane, m/s. */
export const LANE_SHIFT = 3;
// ponytail: the most a car leans into a lane change, radians; standing, it would turn side-on.
const MAX_LEAN = 0.35;
/** How fast a car is drawn leaning into a lane change and out of it, rad/s. */
export const LEAN_TURN = 1;
/**
 * How fast a car is drawn swinging round from the curve to one way out to the curve to another,
 * m/s and rad/s, whichever takes longer; it stands still till it is round.
 */
export const SWING = { move: 10, turn: 1.5 };

/** Where the cars are drawn, one slot per car. */
export interface Drawn {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The traffic owns `t`, `lane`, `nextE`, `nextF`; this only reads them. */
export function createPoses(
  g: RoadGraph,
  t: Track,
  lane: Uint8Array,
  nextE: Int32Array,
  nextF: Uint8Array,
) {
  const n = lane.length;
  // The road each car came off at its last node, its way there and the offset it was drawn at.
  const fromE = new Int32Array(n).fill(-1);
  const fromF = new Uint8Array(n);
  const fromOff = new Float32Array(n);
  const shown = new Float32Array(n); // metres right of the axis it is drawn at
  const lean = new Float32Array(n);
  // The way out its curve ahead is drawn to; when that changes, the seconds left of its swing
  // round, the whole swing, and how far it was drawn off the new curve as it began.
  const drawnE = new Int32Array(n).fill(-1);
  const drawnF = new Uint8Array(n);
  const swing = new Float32Array(n);
  const swingOf = new Float32Array(n);
  const offX = new Float32Array(n);
  const offZ = new Float32Array(n);
  const offH = new Float32Array(n);
  const spot = { x: 0, y: 0, z: 0, heading: 0 };
  const pose = { x: 0, z: 0, heading: 0 };
  const was = { x: 0, z: 0, heading: 0 };
  const target = (i: number) => laneOffset(g.edges[t.edge[i]].cls, lane[i]);

  /** Puts `p` where car `i` is drawn on its lane and its curves, its way out `next` (-1: none). */
  function aim(i: number, next: number, nextFwd: number, p: Pose) {
    const edge = t.edge[i];
    const s = t.s[i];
    const len = g.edges[edge].len;
    const forward = t.forward[i] === 1;
    const at = pointOn(g, edge, s, forward, shown[i], spot);
    p.x = at.x;
    p.z = at.z;
    p.heading = at.heading;
    const from = fromE[i];
    // The curve from the node behind, then the one to the node ahead; they never overlap.
    const back = from >= 0 ? reach(g, from, edge) : 0;
    const ahead = next >= 0 ? reach(g, edge, next) : 0;
    // A car can stand a hair past its road's end before it has a way out: no curve then.
    if (from >= 0 && s < back) {
      cornerAt(g, from, fromF[i] === 1, fromOff[i], edge, forward, shown[i], back + s, p);
    } else if (next >= 0 && len - s < ahead) {
      const d = ahead - (len - s);
      cornerAt(g, edge, forward, shown[i], next, nextFwd === 1, shown[i], d, p);
    }
  }

  return {
    /** Car `i` is put down anew: drawn on its lane, off any curve. */
    reset(i: number) {
      fromE[i] = -1;
      shown[i] = target(i);
      lean[i] = 0;
      drawnE[i] = nextE[i];
      drawnF[i] = nextF[i];
      swing[i] = 0;
    },

    /** Car `i` is about to cross its node from the edge it is on. */
    crossing(i: number) {
      fromE[i] = t.edge[i];
      fromF[i] = t.forward[i];
      fromOff[i] = shown[i];
      drawnE[i] = -1; // on the next road it has no way out yet
    },

    /**
     * Car `i` may have a new way out: then, before it drives on, it is drawn swinging round to it
     * from the curve to the old one.
     */
    turnTo(i: number) {
      if (nextE[i] === drawnE[i]) return;
      aim(i, nextE[i], nextF[i], pose);
      aim(i, drawnE[i], drawnF[i], was);
      drawnE[i] = nextE[i];
      drawnF[i] = nextF[i];
      offX[i] = was.x - pose.x;
      offZ[i] = was.z - pose.z;
      offH[i] = wrap(was.heading - pose.heading);
      swingOf[i] = Math.max(
        Math.hypot(offX[i], offZ[i]) / SWING.move,
        Math.abs(offH[i]) / SWING.turn,
      );
      swing[i] = swingOf[i];
    },

    /** Is car `i` still swinging round to a new way out? It stands till it is round. */
    swinging(i: number): boolean {
      return swing[i] > 0;
    },

    /**
     * Car `i` drove `moved` metres in `h` seconds: it is drawn that much nearer its lane and its
     * new way out. The metres it is still drawn off its lane.
     */
    ease(i: number, h: number, moved: number): number {
      const step = Math.max(-LANE_SHIFT * h, Math.min(LANE_SHIFT * h, target(i) - shown[i]));
      shown[i] += step;
      const tilt =
        step === 0 ? 0 : Math.max(-MAX_LEAN, Math.min(MAX_LEAN, Math.atan2(step, moved)));
      lean[i] += Math.max(-LEAN_TURN * h, Math.min(LEAN_TURN * h, tilt - lean[i]));
      swing[i] = Math.max(0, swing[i] - h);
      return Math.abs(target(i) - shown[i]);
    },

    /** Writes where car `i` is drawn into `out`. */
    put(i: number, out: Drawn) {
      aim(i, nextE[i], nextF[i], pose);
      const w = swing[i] > 0 ? swing[i] / swingOf[i] : 0;
      out.x[i] = pose.x + offX[i] * w;
      out.y[i] = spot.y; // on the deck of a bridge
      out.z[i] = pose.z + offZ[i] * w;
      // Moving right turns the nose right of the way: heading `atan2(dx, dz)` goes down.
      out.heading[i] = pose.heading + offH[i] * w - lean[i];
    },
  };
}

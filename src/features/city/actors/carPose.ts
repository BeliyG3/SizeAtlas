/**
 * Where a ground car is drawn: on its lane, on a curve through the node it turns at, easing
 * across to another lane; display only, the driving never reads it. Pure, no three.js.
 */
import { pointOn, type RoadGraph } from "../world/roads";
import { cornerAt, reach } from "./corners";
import { laneOffset } from "./junctions";
import type { Track } from "./nav";

/** How fast a car is drawn moving across to another lane, m/s. */
export const LANE_SHIFT = 3;
// ponytail: the most a car leans into a lane change, radians; standing, it would turn side-on.
const MAX_LEAN = 0.35;

/** Where the cars are drawn, one slot per car. */
export interface Drawn {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
}

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
  const spot = { x: 0, y: 0, z: 0, heading: 0 };
  const pose = { x: 0, z: 0, heading: 0 };
  const target = (i: number) => laneOffset(g.edges[t.edge[i]].cls, lane[i]);

  return {
    /** Car `i` is put down anew: drawn on its lane, off any curve. */
    reset(i: number) {
      fromE[i] = -1;
      shown[i] = target(i);
      lean[i] = 0;
    },

    /** Car `i` is about to cross its node from the edge it is on. */
    crossing(i: number) {
      fromE[i] = t.edge[i];
      fromF[i] = t.forward[i];
      fromOff[i] = shown[i];
    },

    /** Car `i` drove `moved` metres in `h` seconds: it is drawn that much nearer its lane. */
    ease(i: number, h: number, moved: number) {
      const step = Math.max(-LANE_SHIFT * h, Math.min(LANE_SHIFT * h, target(i) - shown[i]));
      shown[i] += step;
      const tilt = step === 0 ? 0 : Math.atan2(step, moved);
      lean[i] = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, tilt));
    },

    /** Writes where car `i` is drawn into `out`. */
    put(i: number, out: Drawn) {
      const edge = t.edge[i];
      const s = t.s[i];
      const len = g.edges[edge].len;
      const forward = t.forward[i] === 1;
      const p = pointOn(g, edge, s, forward, shown[i], spot);
      out.x[i] = p.x;
      out.y[i] = p.y; // on the deck of a bridge
      out.z[i] = p.z;
      let heading = p.heading;
      const from = fromE[i];
      const next = nextE[i];
      // The curve from the node behind, then the one to the node ahead; they never overlap.
      const back = from >= 0 ? reach(g, from, edge) : 0;
      const ahead = next >= 0 ? reach(g, edge, next) : 0;
      let bent = false;
      if (s < back) {
        bent = cornerAt(
          g,
          from,
          fromF[i] === 1,
          fromOff[i],
          edge,
          forward,
          shown[i],
          back + s,
          pose,
        );
      } else if (len - s < ahead) {
        const d = ahead - (len - s);
        bent = cornerAt(g, edge, forward, shown[i], next, nextF[i] === 1, shown[i], d, pose);
      }
      if (bent) {
        out.x[i] = pose.x;
        out.z[i] = pose.z;
        heading = pose.heading;
      }
      // Moving right turns the nose right of the way: heading `atan2(dx, dz)` goes down.
      out.heading[i] = heading - lean[i];
    },
  };
}

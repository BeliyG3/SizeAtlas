/**
 * The curve a car is drawn on through a node, from the lane it comes in on to the lane it leaves
 * by; pure, no three.js.
 */
import { pointOn, type RoadGraph } from "../world/roads";

/** How far before and after a node the curve reaches at most, metres. */
export const CORNER = 8;
// Under a turn of 5 degrees a car runs straight on through the node.
const STRAIGHT = Math.cos((5 * Math.PI) / 180);
// Pieces of the table that spreads the car evenly along the curve's length.
const STEPS = 16;
// The lanes' crossing is no good for the middle point when it lies behind an end or this many reaches ahead.
const FAR = 3;

export interface Pose {
  x: number;
  z: number;
  /** `atan2(dx, dz)` of the curve there. */
  heading: number;
}

/** How far before and after the node from `inE` to `outE` the curve reaches, metres. */
export function reach(g: RoadGraph, inE: number, outE: number): number {
  return Math.min(CORNER, g.edges[inE].len / 2, g.edges[outE].len / 2);
}

// Scratch, so a frame allocates nothing: control points `x0…x3, z0…z3`, lengths up to each piece.
const cp = new Float64Array(8);
const lengths = new Float64Array(STEPS + 1);
const spot = { x: 0, y: 0, z: 0, heading: 0 };

const at = (o: number, u: number) => {
  const v = 1 - u;
  return v * v * v * cp[o] + 3 * v * u * (v * cp[o + 1] + u * cp[o + 2]) + u * u * u * cp[o + 3];
};
const slope = (o: number, u: number) => {
  const v = 1 - u;
  return (
    v * v * (cp[o + 1] - cp[o]) +
    2 * v * u * (cp[o + 2] - cp[o + 1]) +
    u * u * (cp[o + 3] - cp[o + 2])
  );
};

/**
 * Puts `pose` `d` metres (`0 … 2·reach`, see `reach`) along the way from `reach` before the node
 * on the lane `inOff` metres right of `inE`'s axis to `reach` past it on the lane `outOff` right
 * of `outE`'s, the car spread evenly along the curve. The curve is the quadratic through the
 * crossing of the two lanes; when that crossing is no good (a U-turn, lanes near parallel) it is
 * a cubic with its ends along the lanes. False, `pose` untouched, when the way runs straight on.
 */
export function cornerAt(
  g: RoadGraph,
  inE: number,
  inF: boolean,
  inOff: number,
  outE: number,
  outF: boolean,
  outOff: number,
  d: number,
  pose: Pose,
): boolean {
  const c = reach(g, inE, outE);
  const a = pointOn(g, inE, g.edges[inE].len - c, inF, inOff, spot);
  const x0 = a.x;
  const z0 = a.z;
  const ax = Math.sin(a.heading);
  const az = Math.cos(a.heading);
  const b = pointOn(g, outE, c, outF, outOff, spot);
  const bx = Math.sin(b.heading);
  const bz = Math.cos(b.heading);
  const dot = ax * bx + az * bz;
  if (dot > STRAIGHT) return false;

  // Where the lanes cross: `p` metres on from the start, `q` metres short of the end.
  const rx = b.x - x0;
  const rz = b.z - z0;
  const cross = ax * bz - az * bx;
  const p = (rx * bz - rz * bx) / cross;
  const q = (ax * rz - az * rx) / cross;
  let k0 = (2 / 3) * p; // the quadratic, raised to a cubic
  let k1 = (2 / 3) * q;
  if (!(p > 0.05 && q > 0.05 && p < FAR * c && q < FAR * c)) {
    // ponytail: handles a third of the chord, up to two thirds for a U-turn: near a half circle.
    k0 = k1 = (Math.hypot(rx, rz) / 3) * (dot < 0 ? 1 - dot : 1);
  }
  cp[0] = x0;
  cp[1] = x0 + ax * k0;
  cp[2] = b.x - bx * k1;
  cp[3] = b.x;
  cp[4] = z0;
  cp[5] = z0 + az * k0;
  cp[6] = b.z - bz * k1;
  cp[7] = b.z;

  lengths[0] = 0;
  for (let k = 1; k <= STEPS; k++) {
    const u = k / STEPS;
    const w = (k - 1) / STEPS;
    lengths[k] = lengths[k - 1] + Math.hypot(at(0, u) - at(0, w), at(4, u) - at(4, w));
  }
  const want = Math.min(Math.max(d / (2 * c), 0), 1) * lengths[STEPS];
  let k = 1;
  while (k < STEPS && lengths[k] < want) k++;
  const piece = lengths[k] - lengths[k - 1];
  const u = (k - 1 + (piece > 0 ? (want - lengths[k - 1]) / piece : 0)) / STEPS;
  pose.x = at(0, u);
  pose.z = at(4, u);
  pose.heading = Math.atan2(slope(0, u), slope(4, u));
  return true;
}

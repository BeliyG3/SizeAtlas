/**
 * The game's bodies as discs on the ground plane and how they run into the world and into each
 * other: pushed out, bounced back, slowed along what they hit; pure, no three.js, and nothing is
 * allocated in a step.
 */
import type { Solids } from "./solids";

/**
 * A body: its discs lie along its heading (`yaw`, with the heading `(sin yaw, cos yaw)`),
 * `discs` metres from (x, z). The physics moves x and z; y and vy are the caller's.
 */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  discs: readonly number[];
  radius: number;
  mass: number;
  flying: boolean;
}

/** A person: one disc. */
export const PERSON_DISCS: readonly number[] = [0];
export const PERSON_RADIUS = 0.35;
/** A car: three discs along the body. */
export const CAR_DISCS: readonly number[] = [-1.4, 0, 1.4];
export const CAR_RADIUS = 1.2;
/** A car drives up anything this high over its wheels; higher is a wall. */
export const CAR_CLIMB = 0.6;

/** A car follows a continuous rise up to this steep, metres per metre: ramps, deck ends. */
export const CAR_SLOPE = 0.5;

/** A step moves a body in parts no longer than this (and than its radius), so it cannot pass a thin wall. */
export const MAX_STEP_MOVE = 0.5;
/** What is left of the speed into a wall or another body after the hit, the other way. */
export const BOUNCE = 0.3;
/** The speed along a wall a body is pressed to falls by this part a second (about 0.1 a step at 60 Hz). */
export const SLIDE_DRAG = 6;
/** A surface higher than this over a body passes overhead: a bridge deck above. */
export const HEADROOM = 2;

/** Points around a disc's rim that probe the world, then its centre (no direction). */
const RIM = 12;
const PROBES = RIM + 1;
// A rise of exactly the climb limit (0.6 over a 1 m hover onto a 1.6 m roof) is no wall: float slack.
const EPS = 1e-6;
const PROBE_X = Float64Array.from({ length: PROBES }, (_, i) =>
  i < RIM ? Math.cos((i * 2 * Math.PI) / RIM) : 0,
);
const PROBE_Z = Float64Array.from({ length: PROBES }, (_, i) =>
  i < RIM ? Math.sin((i * 2 * Math.PI) / RIM) : 0,
);
/** A push out of a wall moves the body this part of its radius, at most this many times. */
const PUSH = 1 / 8;
const PUSHES = 8;
/** A rise is walked from the body's centre out to a probe in steps this long, metres. */
const TRACE = 0.3;

/**
 * Whether the probe (x, z) stops `b`: water (unless it flies), or a rise over `climb` (a step)
 * that is not a ramp: one no steeper than `slope` from the body's support (its centre, at
 * `base`) out to the probe, with no step over `climb` on the way.
 */
function blocked(
  b: Body,
  s: Solids,
  climb: number,
  slope: number,
  base: number,
  x: number,
  z: number,
): boolean {
  const top = b.y + HEADROOM;
  if (!b.flying && s.isWater(x, z, top)) return true;
  const rise = s.heightAt(x, z, top) - base;
  if (rise <= climb + EPS) return false;
  const dx = x - b.x;
  const dz = z - b.z;
  const d = Math.hypot(dx, dz);
  if (rise > slope * d) return true;
  const steps = Math.ceil(d / TRACE);
  let prev = base;
  for (let i = 1; i <= steps; i++) {
    const h = s.heightAt(b.x + (dx * i) / steps, b.z + (dz * i) / steps, top);
    if (h - prev > climb + EPS) return true;
    prev = h;
  }
  return false;
}

/**
 * Pushes `b` out of the walls (see `blocked`; `slope` 0: any rise over `climb` is a wall) and,
 * unless it flies, out of the water; its speed into the wall bounces back `BOUNCE` of itself,
 * that along it loses `SLIDE_DRAG` a second over `dt`. Returns the hit: the speed into the wall
 * before it, m/s (0 for none).
 */
export function collideStatic(b: Body, s: Solids, climb: number, dt: number, slope = 0): number {
  let impact = 0;
  const keep = Math.exp(-SLIDE_DRAG * dt);
  // The way it came, before any bounce here.
  const backX = -b.vx;
  const backZ = -b.vz;
  // The last wall it ran into: what it slides along.
  let wallX = 0;
  let wallZ = 0;
  for (let push = 0; push < PUSHES; push++) {
    let px = 0;
    let pz = 0;
    let hits = 0;
    const sin = Math.sin(b.yaw);
    const cos = Math.cos(b.yaw);
    // What it stands on now (its height lags a step behind on a ramp); inside a house, its own y.
    const under = s.heightAt(b.x, b.z, b.y + climb);
    const base = under <= b.y + climb ? Math.max(b.y, under) : b.y;
    for (let k = 0; k < b.discs.length; k++) {
      const cx = b.x + sin * b.discs[k];
      const cz = b.z + cos * b.discs[k];
      for (let i = 0; i < PROBES; i++) {
        const x = cx + PROBE_X[i] * b.radius;
        if (blocked(b, s, climb, slope, base, x, cz + PROBE_Z[i] * b.radius)) {
          px -= PROBE_X[i];
          pz -= PROBE_Z[i];
          hits++;
        }
      }
    }
    if (hits === 0) break;
    let len = Math.hypot(px, pz);
    if (len < 1e-9) {
      // Walls on every side, or only under a centre: back the way it came.
      px = backX;
      pz = backZ;
      len = Math.hypot(px, pz);
      if (len < 1e-9) break;
    }
    const nx = px / len;
    const nz = pz / len;
    b.x += nx * b.radius * PUSH;
    b.z += nz * b.radius * PUSH;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      b.vx -= (1 + BOUNCE) * vn * nx;
      b.vz -= (1 + BOUNCE) * vn * nz;
      wallX = nx;
      wallZ = nz;
    }
  }
  if (impact > 0) {
    // The drag along the wall, once a call.
    const vn = b.vx * wallX + b.vz * wallZ;
    b.vx = (b.vx - vn * wallX) * keep + vn * wallX;
    b.vz = (b.vz - vn * wallZ) * keep + vn * wallZ;
  }
  return impact;
}

/**
 * Moves `b` by its speed over `dt` in parts no longer than `MAX_STEP_MOVE` and its radius,
 * colliding with the world after each (see `collideStatic`; `slope` as there). A body touching a
 * wall is in touch for the rest of the step: the slide drag counts once, over all of `dt`, so it
 * is the same at any speed. Returns the hardest hit, m/s.
 */
export function moveBody(b: Body, dt: number, s: Solids, climb: number, slope = 0): number {
  const parts = Math.max(
    1,
    Math.ceil((Math.hypot(b.vx, b.vz) * dt) / Math.min(MAX_STEP_MOVE, b.radius)),
  );
  const h = dt / parts;
  let impact = 0;
  let drag = dt;
  for (let i = 0; i < parts; i++) {
    b.x += b.vx * h;
    b.z += b.vz * h;
    const hit = collideStatic(b, s, climb, drag, slope);
    if (hit > 0) drag = 0;
    impact = Math.max(impact, hit);
  }
  return impact;
}

/**
 * Parts two bodies whose discs overlap (unless one passes over the other), by their masses (an
 * infinite one does not move), and bounces them apart `BOUNCE` of their closing speed. Returns
 * the hit: the closing speed before it, m/s (0 for none).
 */
export function collideBodies(a: Body, b: Body): number {
  if (Math.abs(a.y - b.y) >= HEADROOM) return 0;
  const ia = 1 / a.mass;
  const ib = 1 / b.mass;
  if (ia + ib === 0) return 0;
  let depth = 0;
  let nx = 0;
  let nz = 0;
  const sa = Math.sin(a.yaw);
  const ca = Math.cos(a.yaw);
  const sb = Math.sin(b.yaw);
  const cb = Math.cos(b.yaw);
  for (let i = 0; i < a.discs.length; i++) {
    for (let k = 0; k < b.discs.length; k++) {
      const dx = b.x + sb * b.discs[k] - (a.x + sa * a.discs[i]);
      const dz = b.z + cb * b.discs[k] - (a.z + ca * a.discs[i]);
      const d = Math.hypot(dx, dz);
      const overlap = a.radius + b.radius - d;
      if (overlap <= depth) continue;
      depth = overlap;
      // Discs on one spot part along x.
      nx = d > 1e-9 ? dx / d : 1;
      nz = d > 1e-9 ? dz / d : 0;
    }
  }
  if (depth <= 0) return 0;
  const wa = ia / (ia + ib);
  const wb = ib / (ia + ib);
  a.x -= nx * depth * wa;
  a.z -= nz * depth * wa;
  b.x += nx * depth * wb;
  b.z += nz * depth * wb;
  const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (closing >= 0) return 0;
  const j = (-(1 + BOUNCE) * closing) / (ia + ib);
  a.vx -= j * ia * nx;
  a.vz -= j * ia * nz;
  b.vx += j * ib * nx;
  b.vz += j * ib * nz;
  return -closing;
}

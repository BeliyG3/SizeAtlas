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

/** A step moves a body in parts no longer than this (and than its radius), so it cannot pass a thin wall. */
export const MAX_STEP_MOVE = 0.5;
/** What is left of the speed into a wall or another body after the hit, the other way. */
export const BOUNCE = 0.3;
/** What is left of the speed along a wall after a hit. */
export const SLIDE_KEEP = 0.9;
/** A surface higher than this over a body passes overhead: a bridge deck above. */
export const HEADROOM = 2;

/** Points around a disc's rim that probe the world. */
const RIM = 12;
const RIM_X = Float64Array.from({ length: RIM }, (_, i) => Math.cos((i * 2 * Math.PI) / RIM));
const RIM_Z = Float64Array.from({ length: RIM }, (_, i) => Math.sin((i * 2 * Math.PI) / RIM));
/** A push out of a wall moves the body this part of its radius, at most this many times. */
const PUSH = 1 / 8;
const PUSHES = 8;

function blocked(b: Body, s: Solids, climb: number, x: number, z: number): boolean {
  return s.heightAt(x, z, b.y + HEADROOM) > b.y + climb || (!b.flying && s.isWater(x, z));
}

/**
 * Pushes `b` out of the walls (anything higher than `climb` over it) and, unless it flies, out of
 * the water; its speed into the wall bounces back `BOUNCE` of itself and that along it keeps
 * `SLIDE_KEEP`. Returns the hit: the speed into the wall before it, m/s (0 for none).
 */
export function collideStatic(b: Body, s: Solids, climb: number): number {
  let impact = 0;
  for (let push = 0; push < PUSHES; push++) {
    let px = 0;
    let pz = 0;
    const sin = Math.sin(b.yaw);
    const cos = Math.cos(b.yaw);
    for (let k = 0; k < b.discs.length; k++) {
      const cx = b.x + sin * b.discs[k];
      const cz = b.z + cos * b.discs[k];
      for (let i = 0; i < RIM; i++) {
        if (blocked(b, s, climb, cx + RIM_X[i] * b.radius, cz + RIM_Z[i] * b.radius)) {
          px -= RIM_X[i];
          pz -= RIM_Z[i];
        }
      }
    }
    const len = Math.hypot(px, pz);
    // Nothing in the way, or walls all round: no way out to push along.
    if (len < 1e-9) break;
    const nx = px / len;
    const nz = pz / len;
    b.x += nx * b.radius * PUSH;
    b.z += nz * b.radius * PUSH;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      const tx = b.vx - vn * nx;
      const tz = b.vz - vn * nz;
      b.vx = tx * SLIDE_KEEP - BOUNCE * vn * nx;
      b.vz = tz * SLIDE_KEEP - BOUNCE * vn * nz;
    }
  }
  return impact;
}

/**
 * Moves `b` by its speed over `dt` in parts no longer than `MAX_STEP_MOVE` and its radius,
 * colliding with the world after each (see `collideStatic`). Returns the hardest hit, m/s.
 */
export function moveBody(b: Body, dt: number, s: Solids, climb: number): number {
  const parts = Math.max(
    1,
    Math.ceil((Math.hypot(b.vx, b.vz) * dt) / Math.min(MAX_STEP_MOVE, b.radius)),
  );
  const h = dt / parts;
  let impact = 0;
  for (let i = 0; i < parts; i++) {
    b.x += b.vx * h;
    b.z += b.vz * h;
    impact = Math.max(impact, collideStatic(b, s, climb));
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

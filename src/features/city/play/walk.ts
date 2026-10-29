/**
 * The player on foot: the pace from the input, the move relative to the camera, steps walked up,
 * jumps with a little forgiveness and falls off low ledges; pure, no three.js, and nothing is
 * allocated in a step.
 */
import { moveBody, PERSON_DISCS, PERSON_RADIUS, type Body } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import type { Actions } from "./input";

/** The paces, m/s; also the speeds the clips are made for. */
export const GAIT = { idle: 0, walk: 1.4, jog: 3.5, sprint: 6 } as const;
export type Gait = keyof typeof GAIT | "air";
/** m/s². */
export const GRAVITY = 20;
/** The highest rise walked up, metres; higher is a wall. */
export const STEP = 0.45;
/** A standing jump rises this high, metres; a running one a little more. */
export const JUMP_H = 1.2;
/** A jump still counts this long after walking off an edge, seconds... */
export const COYOTE = 0.1;
/** ...and a press this long before landing. */
export const JUMP_BUFFER = 0.1;
/** The deepest drop walked or jumped off, metres; a deeper edge (a roof's) is a wall: down by car. */
export const LEDGE = 3;
/** A stick tilted past this runs; under it the pace is the walk, scaled by the tilt. */
const STICK_RUN = 0.8;
/** The jump's push from the run, per m/s. */
const RUN_JUMP = 0.12;
/** A fall from higher than this ends in a short stagger, seconds of it. */
const HARD_FALL = 2;
const STAGGER = 0.45;

export interface Walker {
  /** The feet: `body.y` is their height. */
  body: Body;
  speed: number;
  /** The way of the move, a unit vector on the ground. */
  dirX: number;
  dirZ: number;
  /** Where the walker faces, `atan2(x, z)` as the bodies' yaw. */
  face: number;
  vy: number;
  grounded: boolean;
  canJump: boolean;
  /** In the air from a jump, not a fall. */
  jumped: boolean;
  /** Seconds since leaving the ground without a jump. */
  coyote: number;
  /** Seconds a jump press still waits. */
  buffer: number;
  /** Seconds of a stagger after a hard landing. */
  stagger: number;
  /** The height last stood on: a drop is measured from it. */
  support: number;
  /** The feet as drawn: steps eased, not snapped. */
  shownY: number;
}

export function createWalker(start: { x: number; z: number }, s: Solids): Walker {
  const y = s.heightAt(start.x, start.z);
  const body: Body = {
    x: start.x,
    y,
    z: start.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    discs: PERSON_DISCS,
    radius: PERSON_RADIUS,
    mass: 80,
    flying: false,
  };
  return {
    body,
    speed: 0,
    dirX: 0,
    dirZ: 1,
    face: 0,
    vy: 0,
    grounded: true,
    canJump: true,
    jumped: false,
    coyote: 0,
    buffer: 0,
    stagger: 0,
    support: y,
    shownY: y,
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The pace the input asks for, m/s. */
function paceOf(a: Actions, tilt: number): number {
  if (tilt === 0) return 0;
  if (a.sprint) return GAIT.sprint;
  if (a.analog && tilt > STICK_RUN) return GAIT.jog;
  return GAIT.walk * Math.min(1, tilt / STICK_RUN);
}

/** Whether standing at (x, z) is a drop of more than `LEDGE` from where the walker last stood. */
function overEdge(w: Walker, s: Solids, x: number, z: number): boolean {
  return s.heightAt(x, z, w.body.y + STEP) < w.support - LEDGE;
}

/**
 * Moves the body by the walk over `dt`: walls and steps by the physics, then deep edges as walls,
 * sliding along them on one axis if the other is clear. The edge is felt a radius ahead.
 */
function moveOnFoot(w: Walker, dt: number, s: Solids) {
  const b = w.body;
  const x0 = b.x;
  const z0 = b.z;
  b.vx = w.dirX * w.speed;
  b.vz = w.dirZ * w.speed;
  moveBody(b, dt, s, STEP);
  const dx = b.x - x0;
  const dz = b.z - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return;
  const r = PERSON_RADIUS / len;
  if (!overEdge(w, s, b.x + dx * r, b.z + dz * r)) return;
  const x1 = b.x;
  const z1 = b.z;
  b.x = x0;
  b.z = z0;
  if (Math.abs(dx) > 1e-9 && !overEdge(w, s, x1 + Math.sign(dx) * PERSON_RADIUS, z0)) b.x = x1;
  else if (Math.abs(dz) > 1e-9 && !overEdge(w, s, x0, z1 + Math.sign(dz) * PERSON_RADIUS)) b.z = z1;
}

/** Jumps, falls, lands and keeps to the ground or the steps under the feet. */
function moveUpDown(w: Walker, dt: number, s: Solids) {
  const b = w.body;
  const ground = s.heightAt(b.x, b.z, b.y + STEP);
  if (w.buffer > 0 && (w.grounded || (w.canJump && w.coyote < COYOTE))) {
    w.vy = Math.sqrt(2 * GRAVITY * JUMP_H) + RUN_JUMP * w.speed;
    w.grounded = false;
    w.canJump = false;
    w.jumped = true;
    w.buffer = 0;
  }
  if (w.grounded) {
    w.coyote = 0;
    if (ground < b.y - STEP) {
      // Walked off an edge.
      w.grounded = false;
      w.vy = 0;
      w.jumped = false;
    } else b.y = ground;
  }
  if (!w.grounded) {
    w.coyote += dt;
    // Exact under constant gravity: the peak is the jump's height at any step.
    b.y += w.vy * dt - 0.5 * GRAVITY * dt * dt;
    w.vy -= GRAVITY * dt;
    if (b.y <= ground && (w.vy <= 0 || ground - b.y <= STEP)) {
      if (w.support - ground > HARD_FALL) w.stagger = STAGGER;
      b.y = ground;
      w.vy = 0;
      w.grounded = true;
      w.canJump = true;
      w.jumped = false;
      w.shownY = ground;
    }
  }
  if (w.grounded) w.support = b.y;
  w.shownY = w.grounded ? w.shownY + (b.y - w.shownY) * (1 - Math.exp(-18 * dt)) : b.y;
}

/**
 * One step of `dt` seconds. `camYaw` is the camera's heading (`atan2(x, z)` of its forward): the
 * move is relative to it. Shift (or a stick past `STICK_RUN`) runs.
 */
export function stepWalk(w: Walker, a: Actions, camYaw: number, dt: number, s: Solids): void {
  const ix = a.move.x;
  const iz = a.move.y;
  const tilt = Math.min(1, Math.hypot(ix, iz));
  const want = paceOf(a, tilt);
  if (a.jump) w.buffer = JUMP_BUFFER;
  w.buffer = Math.max(0, w.buffer - dt);
  w.stagger = Math.max(0, w.stagger - dt);

  let inX = 0;
  let inZ = 0;
  if (tilt > 0) {
    // Forward is the camera's heading, right is (-cos, sin).
    const sy = Math.sin(camYaw);
    const cy = Math.cos(camYaw);
    const m = Math.hypot(ix, iz);
    inX = (sy * iz - cy * ix) / m;
    inZ = (cy * iz + sy * ix) / m;
  }
  if (w.grounded) {
    if (tilt > 0) {
      w.dirX = inX;
      w.dirZ = inZ;
    }
    const goal = want * (w.stagger > 0 ? 0.4 : 1);
    w.speed += clamp(goal - w.speed, -14 * dt, (goal > w.speed ? 9 : 14) * dt);
  } else if (tilt > 0) {
    // A little steering in the air: the momentum is kept.
    w.speed += clamp(want - w.speed, -2 * dt, 4 * dt);
    const k = Math.min(1, 3 * dt);
    const x = w.dirX + (inX - w.dirX) * k;
    const z = w.dirZ + (inZ - w.dirZ) * k;
    const len = Math.hypot(x, z) || 1;
    w.dirX = x / len;
    w.dirZ = z / len;
  }
  if ((tilt > 0 || !w.grounded) && w.speed > 0.3) {
    w.face += wrap(Math.atan2(w.dirX, w.dirZ) - w.face) * (1 - Math.exp(-12 * dt));
  }
  if (w.speed > 0.01) moveOnFoot(w, dt, s);
  moveUpDown(w, dt, s);
  w.body.yaw = w.face;
}

/** The clip for the walker's state: by its speed on the ground, `air` off it. */
export function gaitOf(w: Walker): Gait {
  if (!w.grounded) return "air";
  if (w.speed < 0.2) return "idle";
  if (w.speed < 2.4) return "walk";
  return w.speed < 4.8 ? "jog" : "sprint";
}

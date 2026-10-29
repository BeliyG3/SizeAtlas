/**
 * The car in the air: heavy and smooth, the nose is the only way it goes (no strafing), turns
 * bank it, off the throttle it slows to a hover; take-off and landing on the ground, a road or a
 * roof, never on water; pure, no three.js, and nothing is allocated in a step.
 */
import { CAR_CLIMB, CAR_SLOPE, HEADROOM, moveBody } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import { CAR, driveStep, ease, type Car } from "./vehicle";
import type { Actions } from "./input";

/** Seconds a take-off climbs by itself. */
export const LIFT = 0.6;
/** Climb and descent, m/s. */
export const CLIMB_SPEED = 9;
/** The car hovers at least this high over what is under it, metres. */
export const HOVER = 1;
/** How fast the car rises onto a hover height that rose under it, m/s. */
const RISE = 6;
/** The deepest bank, radians. */
export const MAX_ROLL = 0.5;
/** How far past the map's edge a car may fly, metres. */
const EDGE = 150;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** What a flying car would land on under it: a roof, a deck under it, the ground. */
const supportOf = (c: Car, s: Solids) => s.heightAt(c.x, c.z, c.y + CAR_CLIMB);

/**
 * F: on the ground, take off; in the air, land, unless there is water under the car (then
 * `cantLand` is set for the hint and it keeps hovering).
 */
export function toggleFlight(c: Car, s: Solids): void {
  c.cantLand = false;
  if (!c.flying) {
    c.flying = true;
    c.landing = false;
    c.lift = LIFT;
    c.vy = 2;
  } else if (s.isWater(c.x, c.z, c.y)) c.cantLand = true;
  else c.landing = true;
}

/**
 * One step of `dt` seconds in the air. Steering right turns right (the yaw falls) and banks the
 * right side down; `up` and `down` climb and descend, up to `CAR.ceilingAbove` over the tallest
 * house (and never into a deck over it) and never under `HOVER` over what is below. A landing that finds water under the car is
 * called off (`cantLand`).
 */
export function flyStep(c: Car, a: Actions, dt: number, s: Solids): void {
  let vf = c.vf;
  if (a.throttle) vf += a.throttle * 16 * (1 - Math.min(1, Math.max(vf, 0) / CAR.flyTop) ** 2) * dt;
  else vf -= vf * (1 - Math.exp(-0.7 * dt));
  if (a.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 22 * a.brake * dt);
  c.steer = ease(c.steer, a.steer, 3, dt);
  const yawRate = -c.steer * (0.25 + 0.9 / (1 + (vf / 25) ** 2));
  c.yaw += yawRate * dt;
  const sn = Math.sin(c.yaw);
  const cs = Math.cos(c.yaw);
  c.vx = sn * vf;
  c.vz = cs * vf;
  moveBody(c, dt, s, CAR_CLIMB, CAR_SLOPE);
  c.x = clamp(c.x, s.bounds.minX - EDGE, s.bounds.maxX + EDGE);
  c.z = clamp(c.z, s.bounds.minZ - EDGE, s.bounds.maxZ + EDGE);
  // What a wall left of it.
  c.vf = c.vx * sn + c.vz * cs;

  if (c.landing && s.isWater(c.x, c.z, c.y)) {
    c.landing = false;
    c.cantLand = true;
  }
  const g = supportOf(c, s);
  const climb = (a.up || c.lift > 0 ? 1 : 0) - (a.down ? 1 : 0);
  const target = c.landing ? -Math.min(8, (c.y - g) * 1.2 + 0.6) : climb * CLIMB_SPEED;
  c.vy = ease(c.vy, target, c.landing ? 4 : 3, dt);
  let y = c.y + c.vy * dt;
  // The sky's ceiling, or lower a deck over the car: the car stops `HEADROOM` under it.
  const over = s.heightAt(c.x, c.z, y + HEADROOM);
  const sky = s.tallest + CAR.ceilingAbove;
  const top = over > g ? Math.min(sky, Math.max(c.y, over - HEADROOM)) : sky;
  if (y >= top) {
    y = top;
    c.vy = Math.min(c.vy, 0);
  }
  // Landing, it comes down onto the support; otherwise it hovers over it.
  const floor = g + (c.landing ? 0 : HOVER);
  if (y < floor) {
    // Its own descent stops on the floor; a floor that rose under it (a low roof flown onto, a
    // take-off) is climbed at `RISE`, not in a step.
    y = c.y >= floor ? floor : Math.min(floor, Math.max(y, c.y) + RISE * dt);
    if (c.vy < 0 && !c.landing) c.vy = 0;
  }
  c.y = y;
  c.lift = Math.max(0, c.lift - dt);
  if (c.landing && c.y <= g + 0.02) {
    // Down: the driving takes over.
    c.flying = false;
    c.landing = false;
    c.y = g;
    c.vy = 0;
    c.lift = 0;
  }

  const bank = -yawRate * 0.55 * (0.35 + Math.min(1, Math.abs(vf) / 20));
  c.roll = ease(c.roll, clamp(bank, -MAX_ROLL, MAX_ROLL), 4, dt);
  c.pitch = ease(c.pitch, clamp((vf / CAR.flyTop) * 0.12 - c.vy * 0.012, -0.25, 0.25), 3, dt);
  c.flyT = ease(c.flyT, c.flying ? 1 : 0, 4, dt);
  c.bob += dt;
}

/** One step of `dt` seconds of the car, in the air or on the ground. */
export function carStep(c: Car, a: Actions, dt: number, s: Solids): void {
  if (c.flying) flyStep(c, a, dt, s);
  else driveStep(c, a, dt, s);
}

/** The hover's light bob as drawn over `c.y`, metres: at rest in the air, none at speed. */
export function hoverBob(c: Car): number {
  const still = 1 - Math.min(1, Math.abs(c.vf) / 10);
  return (Math.sin(c.bob * 1.7) * 0.12 + Math.sin(c.bob * 0.9) * 0.08) * c.flyT * still;
}

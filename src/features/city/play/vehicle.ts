/**
 * A car on the ground: the speed in the car's frame, grip that lets go in a slide, a handbrake,
 * brakes that stop it, and its height on what it stands on (roads, bridge decks, a roof it landed
 * on); pure, no three.js, and nothing is allocated in a step. Flight is in `vehicleFly`.
 */
import {
  CAR_CLIMB,
  CAR_DISCS,
  CAR_RADIUS,
  CAR_SLOPE,
  moveBody,
  type Body,
} from "../physics/bodies";
import type { Solids } from "../physics/solids";
import type { Actions } from "./input";
import { GRAVITY } from "./walk";

/**
 * Top speeds forward and back on the ground and forward in the air, m/s; the wheelbase and the
 * flight ceiling over the tallest house, metres.
 */
export const CAR = { top: 30, reverse: 8, wheelbase: 3.1, flyTop: 38, ceilingAbove: 30 } as const;
export const CAR_MASS = 1200;

export type Owner = "player" | "traffic" | "empty";

export interface Car extends Body {
  /** The wheels' turn as eased toward the input, -1..1, right is positive. */
  steer: number;
  /** About the nose, radians: positive puts the right side down. */
  roll: number;
  /** About the car's side, radians: positive puts the nose down. */
  pitch: number;
  /** The speed along the nose, m/s. */
  vf: number;
  /** Coming down to land. */
  landing: boolean;
  /** Seconds the take-off still climbs by itself. */
  lift: number;
  /** The last landing was refused: there was water under the car. Cleared by the next F. */
  cantLand: boolean;
  /** 0 on the ground .. 1 fully up, eased: for the camera and the drawing. */
  flyT: number;
  /** Seconds in the air, for the hover's bob. */
  bob: number;
  owner: Owner;
}

/** Who has the car; an empty car stands where it was left: people do not push it. */
export function setOwner(c: Car, owner: Owner): void {
  c.owner = owner;
  c.mass = owner === "empty" ? Infinity : CAR_MASS;
}

/** A car standing on what is at (x, z), nose along `yaw`. */
export function createCar(x: number, z: number, yaw: number, s: Solids, owner: Owner): Car {
  const c: Car = {
    x,
    y: s.heightAt(x, z),
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    discs: CAR_DISCS,
    radius: CAR_RADIUS,
    mass: CAR_MASS,
    flying: false,
    steer: 0,
    roll: 0,
    pitch: 0,
    vf: 0,
    landing: false,
    lift: 0,
    cantLand: false,
    flyT: 0,
    bob: 0,
    owner,
  };
  setOwner(c, owner);
  return c;
}

/** `v` eased toward `to` at `rate` a second over `dt`. */
export const ease = (v: number, to: number, rate: number, dt: number) =>
  v + (to - v) * (1 - Math.exp(-rate * dt));

/** Up a ramp or a kerb at once; off a drop deeper than a kerb (a roof's edge) it falls. */
function followGround(c: Car, dt: number, s: Solids) {
  const g = s.heightAt(c.x, c.z, c.y + CAR_CLIMB);
  if (c.vy === 0 && g >= c.y - CAR_CLIMB) {
    c.y = g;
    return;
  }
  c.vy -= GRAVITY * dt;
  c.y += c.vy * dt;
  if (c.y <= g) {
    c.y = g;
    c.vy = 0;
  }
}

/**
 * One step of `dt` seconds on the ground. Steering right turns the car right (its yaw falls);
 * `handbrake` (Space, the pad's X) lets the grip go in a turn. The brake stops the car and does
 * not carry it past a standstill: held on from rest, it backs up to `CAR.reverse`.
 */
export function driveStep(c: Car, a: Actions, dt: number, s: Solids): void {
  const hb = a.handbrake;
  let vf = c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);
  // Steering eases in, and is lighter at speed.
  const want = a.steer / (1 + (vf / 10) ** 2);
  c.steer = ease(c.steer, want, a.steer ? 5 : 9, dt);
  c.yaw -= ((vf * Math.tan(c.steer * 0.55)) / CAR.wheelbase) * (hb ? 1.5 : 1) * dt;
  const sn = Math.sin(c.yaw);
  const cs = Math.cos(c.yaw);
  // The speed did not turn with the car: what is across it now is the slip (right is positive).
  vf = c.vx * sn + c.vz * cs;
  let vl = -c.vx * cs + c.vz * sn;

  let acc = 0;
  if (a.throttle) acc += a.throttle * 11 * (1 - Math.min(1, Math.max(vf, 0) / CAR.top) ** 2);
  if (a.brake) {
    acc +=
      vf > 0.4
        ? -a.brake * 24
        : -a.brake * 6 * (1 - Math.min(1, Math.max(-vf, 0) / CAR.reverse) ** 2);
  }
  acc -= Math.sign(vf) * (0.6 + (hb ? 7 : 0));
  const before = vf;
  vf += acc * dt;
  // Brakes and rolling friction stop the car, they do not turn it back.
  if (before > 0 !== vf > 0 && !a.throttle && !(a.brake && before <= 0)) vf = 0;
  // The grip across: strong, letting go in a slide and on the handbrake.
  const slip = Math.abs(vl) / (Math.abs(vf) + 2);
  vl *= Math.exp(-(hb ? 1.2 : slip > 0.5 ? 4.5 : 8) * dt);

  c.vx = sn * vf - cs * vl;
  c.vz = cs * vf + sn * vl;
  moveBody(c, dt, s, CAR_CLIMB, CAR_SLOPE);
  // What a wall left of it.
  c.vf = c.vx * sn + c.vz * cs;
  followGround(c, dt, s);
  c.roll = ease(c.roll, 0, 6, dt);
  c.pitch = ease(c.pitch, 0, 6, dt);
  c.flyT = ease(c.flyT, 0, 4, dt);
}

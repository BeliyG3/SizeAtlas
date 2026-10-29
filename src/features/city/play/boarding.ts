/**
 * Getting into a car and out of it: the driver's door within reach on the player's own level, a
 * car of the player's or one taken from the traffic, and where the player steps out, never into a
 * house, onto water or down off a roof; pure, no three.js.
 */
import type { Traffic } from "../actors/traffic";
import { CAR_DISCS, CAR_RADIUS, PERSON_RADIUS } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import { CAR_LENGTH } from "../render/cars";
import type { Car } from "./vehicle";
import { STEP } from "./walk";

/** E reaches a driver's door this far away, metres. */
export const REACH = 3;
/** The player steps out this far beside the car's middle, metres... */
export const BESIDE = 2.4;
/** ...or, with both sides shut, this far behind it. */
export const BEHIND = CAR_LENGTH / 2 + 1;

/** The car model's own length, metres: the clips' spots below are in its frame. */
export const MODEL_LENGTH = 5.05;
/** The model is drawn `CAR_LENGTH` long: its frame is this many metres to the metre. */
export const MODEL_SCALE = CAR_LENGTH / MODEL_LENGTH;

/**
 * walker.glb's clips for the car, seconds, and where the person stands for each in the car's
 * frame (its left is +x, its nose +z): the clips are in place there.
 */
export const CLIP = {
  enter: {
    length: 3.566666666666667,
    x: 1.8553091312072651,
    z: -0.24166717890774603,
    yaw: -1.5753269967167687,
  },
  exit: {
    length: 3.1666666666666665,
    x: 1.5701567642100103,
    z: -0.1950734776838469,
    yaw: 1.5662717388576364,
  },
} as const;

/** A point on the ground. */
export interface Spot {
  x: number;
  z: number;
}

/** (x, z) in the car's model frame written to `out`: the car at (cx, cz) with its nose along `yaw`. */
export function toCar(x: number, z: number, cx: number, cz: number, yaw: number, out: Spot): Spot {
  const dx = (x - cx) / MODEL_SCALE;
  const dz = (z - cz) / MODEL_SCALE;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}

/** The point (x, z) of the car's model frame in the world, written to `out`. */
export function fromCar(
  x: number,
  z: number,
  cx: number,
  cz: number,
  yaw: number,
  out: Spot,
): Spot {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.x = cx + (x * c + z * s) * MODEL_SCALE;
  out.z = cz + (-x * s + z * c) * MODEL_SCALE;
  return out;
}

/** The driver's door: where the person stands to get in, for a car at (cx, cz) nose along `yaw`. */
export const doorOf = (cx: number, cz: number, yaw: number, out: Spot) =>
  fromCar(CLIP.enter.x, CLIP.enter.z, cx, cz, yaw, out);

export interface Door {
  kind: "car" | "traffic";
  /** In the cars given, or the traffic's slot. */
  index: number;
  door: Spot;
}

/** A person at (x, z) is in the body of a car at (cx, cz) nose along `yaw`. */
function inBody(x: number, z: number, cx: number, cz: number, yaw: number): boolean {
  for (const off of CAR_DISCS) {
    const dx = cx + Math.sin(yaw) * off - x;
    const dz = cz + Math.cos(yaw) * off - z;
    if (Math.hypot(dx, dz) < CAR_RADIUS + PERSON_RADIUS) return true;
  }
  return false;
}

/**
 * The nearest driver's door within `REACH` of feet at (px, py, pz) on their level (a step up or
 * down at most): of an empty car of `cars` or a live ground car of `traffic` that has grown in;
 * null if none. A door whose spot is blocked (by a house, water, a drop or another car) is not
 * reached.
 */
export function nearestDoor(
  px: number,
  py: number,
  pz: number,
  cars: readonly Car[],
  traffic: Traffic | null,
  s: Solids,
): Door | null {
  let best: Door | null = null;
  let near = REACH;
  const spot = { x: 0, z: 0 };
  const blocked = (kind: Door["kind"], index: number, y: number) => {
    if (!clear(s, spot.x, spot.z, y)) return true;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!(kind === "car" && i === index) && inBody(spot.x, spot.z, c.x, c.z, c.yaw)) return true;
    }
    for (let i = 0; traffic && i < traffic.count; i++) {
      if (!traffic.live[i] || traffic.air[i] || (kind === "traffic" && i === index)) continue;
      if (inBody(spot.x, spot.z, traffic.x[i], traffic.z[i], traffic.heading[i])) return true;
    }
    return false;
  };
  const consider = (
    kind: Door["kind"],
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) => {
    if (Math.abs(y - py) > STEP) return;
    doorOf(x, z, yaw, spot);
    const d = Math.hypot(spot.x - px, spot.z - pz);
    if (d > near || blocked(kind, index, y)) return;
    near = d;
    best = { kind, index, door: { x: spot.x, z: spot.z } };
  };
  cars.forEach((c, i) => {
    if (c.owner === "empty" && !c.flying) consider("car", i, c.x, c.y, c.z, c.yaw);
  });
  for (let i = 0; traffic && i < traffic.count; i++) {
    if (traffic.live[i] && !traffic.air[i] && traffic.appear[i] >= 1) {
      consider("traffic", i, traffic.x[i], traffic.y[i], traffic.z[i], traffic.heading[i]);
    }
  }
  return best;
}

/** A person at (x, z) stands on dry land or a deck within a step of `level`, its whole disc. */
function clear(s: Solids, x: number, z: number, level: number): boolean {
  const top = level + STEP;
  for (let i = 0; i <= 4; i++) {
    const a = (i * Math.PI) / 2;
    const r = i < 4 ? PERSON_RADIUS : 0;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (s.isWater(px, pz, top) || Math.abs(s.heightAt(px, pz, top) - level) > STEP) return false;
  }
  return true;
}

/** Out through the driver's door, the other one, or (both shut) over the back. */
export type ExitSide = "door" | "other" | "back";

/**
 * Where the player steps out of a car standing still, written to `out`: beside its driver's door
 * (its left), else beside the other, else behind it. Null when none is clear: the player stays in.
 */
export function exitSpot(car: Car, s: Solids, out: Spot): ExitSide | null {
  const sn = Math.sin(car.yaw);
  const cs = Math.cos(car.yaw);
  const tries: [ExitSide, number, number][] = [
    ["door", cs * BESIDE, -sn * BESIDE],
    ["other", -cs * BESIDE, sn * BESIDE],
    ["back", -sn * BEHIND, -cs * BEHIND],
  ];
  for (const [side, dx, dz] of tries) {
    if (!clear(s, car.x + dx, car.z + dz, car.y)) continue;
    out.x = car.x + dx;
    out.z = car.z + dz;
    return side;
  }
  return null;
}

/**
 * A temporary way into and out of the car: E within reach of it on its own level, out beside it
 * on the same level, never into a house, onto water or down off a roof; pure, no three.js.
 */
// ponytail: Task 7 replaces this with the clips and the driver's door.
import { PERSON_RADIUS } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import type { Car } from "./vehicle";
import { STEP } from "./walk";

/** E reaches a car this far from the nearest of its discs, metres. */
export const REACH = 3;
/** The player steps out this far from the car's middle, metres. */
export const BESIDE = 2.4;

/** Feet at (x, y, z) are within `REACH` of `car` and on its level (a step up or down at most). */
export function canBoard(car: Car, x: number, y: number, z: number): boolean {
  if (Math.abs(y - car.y) > STEP) return false;
  for (const off of car.discs) {
    const dx = car.x + Math.sin(car.yaw) * off - x;
    const dz = car.z + Math.cos(car.yaw) * off - z;
    if (Math.hypot(dx, dz) <= REACH) return true;
  }
  return false;
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

/**
 * Where the player steps out of a car standing still: beside it on its left, else on its right,
 * written to `out`. False when neither side is clear: the player stays in.
 */
export function exitSpot(car: Car, s: Solids, out: { x: number; z: number }): boolean {
  const lx = Math.cos(car.yaw);
  const lz = -Math.sin(car.yaw);
  for (const side of [1, -1]) {
    const x = car.x + lx * BESIDE * side;
    const z = car.z + lz * BESIDE * side;
    if (clear(s, x, z, car.y)) {
      out.x = x;
      out.z = z;
      return true;
    }
  }
  return false;
}

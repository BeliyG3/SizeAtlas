/**
 * A free camera that flies over the city: the stand-in until the player has a body and a camera
 * behind them. Pure, no three.js.
 */
import type { Box } from "../frame";
import type { Actions } from "./input";

export interface Fly {
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical, radians; 0 looks toward -z. */
  yaw: number;
  /** Up is positive, radians. */
  pitch: number;
}

/** The slowest speed, m/s, near the ground; higher up it grows with the height. */
const SPEED = 20;
/** Lowest eye height, metres. */
const FLOOR = 1.7;
const MAX_PITCH = 1.5;

/** Over the south edge of `box`, looking down across it. */
export function startFly(box: Box): Fly {
  const size = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2], 100);
  return {
    x: (box.min[0] + box.max[0]) / 2,
    y: 0.3 * size,
    z: box.max[2] + 0.15 * size,
    yaw: 0,
    pitch: -0.45,
  };
}

/** Turns by this frame's `look` (radians, x right, y down). */
export function turnFly(f: Fly, look: { x: number; y: number }) {
  f.yaw -= look.x;
  f.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, f.pitch - look.y));
}

/** One step of `dt` seconds: forward along the view, strafe, climb (`up`) and descend (`down`). */
export function stepFly(f: Fly, a: Actions, dt: number) {
  const v = Math.max(SPEED, f.y) * dt;
  const sy = Math.sin(f.yaw);
  const cy = Math.cos(f.yaw);
  const cp = Math.cos(f.pitch);
  const climb = (a.up ? 1 : 0) - (a.down ? 1 : 0);
  f.x += (-sy * cp * a.move.y + cy * a.move.x) * v;
  f.z += (-cy * cp * a.move.y - sy * a.move.x) * v;
  f.y = Math.max(FLOOR, f.y + (Math.sin(f.pitch) * a.move.y + climb) * v);
}

/** `out` set to the way from `a` to `b`, `k` of it (position only; the view turns per frame). */
export function lerpFly(out: Fly, a: Fly, b: Fly, k: number) {
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  out.z = a.z + (b.z - a.z) * k;
}

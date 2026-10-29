/**
 * The game's camera: close over the shoulder on foot, a chase behind the car. Springs follow
 * with a lag, the view never enters a house, and nothing is allocated per frame; pure, no three.js.
 */
import type { Solids } from "../physics/solids";

/** On foot: the distance behind, its range, the pivot over the feet, the shoulder offset, metres; fov, degrees. */
export const CAM = { dist: 2.6, min: 1.8, max: 8, pivotH: 1.55, shoulder: 0.45, fov: 55 };
/** The chase behind the car, metres, and its range. */
export const CHASE = { dist: 7, min: 4, max: 14 };
/** The chase is never farther from the car than this many times its distance... */
export const CHASE_REACH = 1.6;
/** ...and its pivot lags the car by at most this many metres, at any speed. */
const CHASE_LAG = 1.5;
/** How far the view may look up and down, radians (up is negative). */
const PITCH = { min: -0.2, max: 1.15 };
/** How far to the side the shoulder looks for a wall, metres. */
const SIDE_ROOM = CAM.shoulder + 0.6;

/** A value and its speed, for `damp`. */
export interface Spring {
  x: number;
  v: number;
}

/**
 * Moves `s` toward `target` with a critically damped spring that settles in about `smooth`
 * seconds; returns the new value.
 */
export function damp(s: Spring, target: number, smooth: number, dt: number): number {
  const om = 2 / smooth;
  const x = om * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = s.x - target;
  const tmp = (s.v + om * change) * dt;
  s.v = (s.v - om * tmp) * e;
  s.x = target + (change + tmp) * e;
  return s.x;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Cam {
  /** The heading wanted, `atan2(x, z)` of the forward; `heading` is the one shown. */
  yaw: number;
  pitch: number;
  dist: number;
  chase: number;
  /** Seconds since the player last turned the view. */
  idle: number;
  /** The shoulder the view keeps to: 1 right, -1 left. */
  side: number;
  ready: boolean;
  heading: Spring;
  shoulder: Spring;
  fov: Spring;
  pivot: { x: Spring; y: Spring; z: Spring };
  /** The distance behind as shown: pulled in at once, eased back out. */
  shown: number;
  /** Where the view is, the point it looks at and its vertical field of view, degrees. */
  eye: Point;
  at: Point;
}

const spring = (x = 0): Spring => ({ x, v: 0 });

export function createCam(yaw: number): Cam {
  return {
    yaw,
    pitch: 0.15,
    dist: CAM.dist,
    chase: CHASE.dist,
    idle: 0,
    side: 1,
    ready: false,
    heading: spring(yaw),
    shoulder: spring(CAM.shoulder),
    fov: spring(CAM.fov),
    pivot: { x: spring(), y: spring(), z: spring() },
    shown: CAM.dist,
    eye: { x: 0, y: 0, z: 0 },
    at: { x: 0, y: 0, z: 0 },
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** An angle in -π..π. */
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Turns the view by this frame's look (radians, x right, y down); a turn puts off the re-centring. */
export function turnCam(c: Cam, look: { x: number; y: number }) {
  if (look.x === 0 && look.y === 0) return;
  c.yaw -= look.x;
  c.pitch = clamp(c.pitch + look.y, PITCH.min, PITCH.max);
  c.idle = 0;
}

/**
 * How far from (x, y, z) along (dx, dy, dz) the view is clear of houses, the ground and decks,
 * up to `max`, with room to spare.
 */
export function free(
  s: Solids,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  max: number,
): number {
  for (let t = 0.3; t <= max; t += 0.3) {
    const py = y + dy * t;
    if (s.heightAt(x + dx * t, z + dz * t, py) > py - 0.25) return Math.max(0, t - 0.6);
  }
  return max;
}

/** Snaps the pivot onto `x, y, z` on the first frame, then springs toward it. */
function follow(c: Cam, x: number, y: number, z: number, smooth: number, dt: number) {
  if (!c.ready) {
    c.pivot.x.x = x;
    c.pivot.y.x = y;
    c.pivot.z.x = z;
    c.heading.x = c.yaw;
    c.ready = true;
  }
  damp(c.pivot.x, x, smooth, dt);
  damp(c.pivot.y, y, smooth, dt);
  damp(c.pivot.z, z, smooth, dt);
}

/**
 * The view behind the walker at `p` (its feet) moving at `speed` m/s facing `face`. `ahead`: the
 * player walks mostly away from the view, so after a while it swings back behind them. Writes
 * `c.eye`, `c.at` and `c.fov`.
 */
export function followWalker(
  c: Cam,
  p: Point,
  speed: number,
  face: number,
  ahead: boolean,
  dt: number,
  s: Solids,
) {
  const run = clamp((speed - 1.4) / 4.6, 0, 1); // 0 walking .. 1 sprinting
  c.idle += dt;
  if (c.idle > 1.5 && speed > 0.5 && ahead) c.yaw += wrap(face - c.yaw) * (1 - Math.exp(-0.9 * dt));
  const py = p.y + CAM.pivotH;
  follow(c, p.x, py, p.z, 0.15, dt);
  const piv = c.pivot;
  // A lagging pivot inside a wall (a fall along a facade): no lag sideways.
  if (s.heightAt(piv.x.x, piv.z.x, piv.y.x) > piv.y.x - 0.1) {
    piv.x.x = p.x;
    piv.z.x = p.z;
    piv.x.v = 0;
    piv.z.v = 0;
  }
  const yaw = damp(c.heading, c.yaw, 0.08, dt);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const cp = Math.cos(c.pitch);
  const bx = -sy * cp;
  const by = Math.sin(c.pitch);
  const bz = -cy * cp;
  const rx = -cy;
  const rz = sy;
  const dist = c.dist + 0.9 * run;
  const ox = piv.x.x;
  const oy = piv.y.x;
  const oz = piv.z.x;
  // The shoulder: its own side, narrowed by a wall, swapped when the other side sees much farther.
  let sh =
    c.side * clamp(free(s, ox, oy, oz, rx * c.side, 0, rz * c.side, SIDE_ROOM), 0, CAM.shoulder);
  const other =
    -c.side * clamp(free(s, ox, oy, oz, -rx * c.side, 0, -rz * c.side, SIDE_ROOM), 0, CAM.shoulder);
  const keep = free(s, ox + rx * sh, oy, oz + rz * sh, bx, by, bz, dist) + Math.abs(sh);
  const swap = free(s, ox + rx * other, oy, oz + rz * other, bx, by, bz, dist) + Math.abs(other);
  if (swap > keep + 0.8) {
    c.side = -c.side;
    sh = other;
  }
  const shoulder = damp(c.shoulder, sh, 0.2, dt);
  const ax = ox + rx * shoulder;
  const az = oz + rz * shoulder;
  const t = Math.max(0.35, free(s, ax, oy, az, bx, by, bz, dist));
  c.shown = t < c.shown ? t : c.shown + (t - c.shown) * (1 - Math.exp(-5 * dt));
  c.eye.x = ax + bx * c.shown;
  c.eye.y = Math.max(oy + by * c.shown, 0.3);
  c.eye.z = az + bz * c.shown;
  c.at.x = ax;
  c.at.y = oy;
  c.at.z = az;
  damp(c.fov, CAM.fov + 5 * run, 0.3, dt);
}

/** What the chase needs of a car: its pose, its speed over the ground and how it steers and flies. */
export interface CarView extends Point {
  yaw: number;
  vx: number;
  vz: number;
  /** -1..1, right is positive. */
  steer: number;
  flying: boolean;
  /** 0 on the ground .. 1 fully up. */
  flyT: number;
}

/**
 * The view behind the car `car`: some `c.chase` metres back and up, with a lag, swinging into
 * turns and slides; farther and wider with speed and in the air. Writes `c.eye`, `c.at`, `c.fov`.
 */
export function followCar(c: Cam, car: CarView, dt: number, s: Solids) {
  const speed = Math.hypot(car.vx, car.vz);
  c.idle += dt;
  const travel = speed > 3 ? Math.atan2(car.vx, car.vz) : car.yaw;
  // A right turn is a falling yaw.
  const want = car.yaw + wrap(travel - car.yaw) * 0.5 - car.steer * 0.25 * clamp(speed / 12, 0, 1);
  if (c.idle > 1.2) c.yaw += wrap(want - c.yaw) * (1 - Math.exp(-3 * dt));
  const yaw = damp(c.heading, c.yaw, 0.25, dt);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const cp = Math.cos(c.pitch);
  const bx = -sy * cp;
  const by = Math.sin(c.pitch);
  const bz = -cy * cp;
  const lead = Math.min(speed * 0.05, 1.5);
  const px = car.x + sy * lead;
  const py = car.y + 1.3;
  const pz = car.z + cy * lead;
  follow(c, px, py, pz, 0.2, dt);
  const piv = c.pivot;
  const lag = Math.hypot(piv.x.x - px, piv.y.x - py, piv.z.x - pz);
  if (lag > CHASE_LAG) {
    const k = CHASE_LAG / lag;
    piv.x.x = px + (piv.x.x - px) * k;
    piv.y.x = py + (piv.y.x - py) * k;
    piv.z.x = pz + (piv.z.x - pz) * k;
  }
  const ox = c.pivot.x.x;
  const oy = c.pivot.y.x;
  const oz = c.pivot.z.x;
  const back = c.chase + speed * 0.04 + 3 * car.flyT;
  const t = Math.max(0.5, free(s, ox, oy, oz, bx, by, bz, back));
  c.shown = t < c.shown ? t : c.shown + (t - c.shown) * (1 - Math.exp(-4 * dt));
  c.eye.x = ox + bx * c.shown;
  c.eye.y = Math.max(oy + by * c.shown, 0.4);
  c.eye.z = oz + bz * c.shown;
  // Fast, climbing and turning, the car keeps its size on screen.
  const reach = c.chase * CHASE_REACH;
  const far = Math.hypot(c.eye.x - car.x, c.eye.y - car.y, c.eye.z - car.z);
  if (far > reach) {
    const k = reach / far;
    c.eye.x = car.x + (c.eye.x - car.x) * k;
    c.eye.y = car.y + (c.eye.y - car.y) * k;
    c.eye.z = car.z + (c.eye.z - car.z) * k;
  }
  c.at.x = ox + sy * 2;
  c.at.y = oy;
  c.at.z = oz + cy * 2;
  const top = car.flying ? 38 : 30;
  damp(c.fov, CAM.fov + 14 * clamp(speed / top, 0, 1) + 4 * car.flyT, 0.3, dt);
}

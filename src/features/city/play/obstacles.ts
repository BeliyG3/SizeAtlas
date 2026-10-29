/**
 * The player and the traffic in each other's way: the traffic's cars near the player as bodies it
 * runs into, and the player and its cars as the obstacles the traffic stops short of; pure, and
 * nothing is allocated in a step.
 */
import type { Obstacles, Traffic } from "../actors/traffic";
import { CAR_DISCS, CAR_RADIUS, type Body } from "../physics/bodies";

/** Each traffic's bodies, one a car, and the list of those near the last call. */
const pools = new WeakMap<Traffic, { bodies: Body[]; near: Body[] }>();

const carBody = (): Body => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  discs: CAR_DISCS,
  radius: CAR_RADIUS,
  // ponytail: kinematic: nothing pushes a traffic car off its lane; give it a mass to be shoved.
  mass: Infinity,
  flying: false,
});

/**
 * The cars of `t` on the roads within `r` metres of `near`, as bodies at rest of infinite mass:
 * the player bounces off them, they keep their lanes. The same list and bodies at every call.
 */
// ponytail: a traffic body has no speed, so the bounce is off a car standing; its speed from the
// traffic's steps if a hit from behind ever looks wrong.
export function trafficBodies(t: Traffic, near: { x: number; z: number }, r = 60): Body[] {
  let p = pools.get(t);
  if (!p) {
    p = { bodies: Array.from({ length: t.count }, carBody), near: [] };
    pools.set(t, p);
  }
  let k = 0;
  for (let i = 0; i < t.count; i++) {
    if (!t.live[i] || (t.x[i] - near.x) ** 2 + (t.z[i] - near.z) ** 2 > r * r) continue;
    const b = p.bodies[i];
    b.x = t.x[i];
    b.y = t.y[i];
    b.z = t.z[i];
    b.yaw = t.heading[i];
    b.flying = t.air[i] === 1;
    p.near[k++] = b;
  }
  p.near.length = k;
  return p.near;
}

/** Room for the obstacles of `cars` cars (a point a disc) and a person. */
export function createObstacles(cars: number): Obstacles {
  const n = cars * CAR_DISCS.length + 1;
  return {
    count: 0,
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    r: new Float64Array(n),
  };
}

/** Obstacle `k` of `o` at (x, y, z), `r` wide; past its room it goes unseen. */
function put(o: Obstacles, k: number, x: number, y: number, z: number, r: number): number {
  if (k >= o.x.length) return k;
  o.x[k] = x;
  o.y[k] = y;
  o.z[k] = z;
  o.r[k] = r;
  return k + 1;
}

/** `o` filled with the discs of `cars` and the person on foot (null: in a car); returns `o`. */
export function fillObstacles(o: Obstacles, cars: readonly Body[], onFoot: Body | null): Obstacles {
  let k = 0;
  for (const c of cars) {
    const sin = Math.sin(c.yaw);
    const cos = Math.cos(c.yaw);
    for (const d of c.discs) k = put(o, k, c.x + sin * d, c.y, c.z + cos * d, c.radius);
  }
  if (onFoot) k = put(o, k, onFoot.x, onFoot.y, onFoot.z, onFoot.radius);
  o.count = k;
  return o;
}

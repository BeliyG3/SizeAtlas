/**
 * The player's states: on foot, getting in, driving, flying, getting out. Any car can be got
 * into: an empty one at once, one of the traffic once its driver has got out and walked off as a
 * resident. Pure, no three.js; the steps allocate nothing (getting in or out allocates once).
 */
import type { Residents } from "../actors/residents";
import type { Traffic } from "../actors/traffic";
import { CAR_CLIMB, CAR_SLOPE, collideBodies, collideStatic } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import { CLIP, exitSpot, fromCar, nearestDoor, toCar, type Spot } from "./boarding";
import {
  backScript,
  enterScript,
  exitScript,
  makeScriptPose,
  poseAt,
  type Script,
} from "./boardingScript";
import type { Actions } from "./input";
import { createCar, setOwner, type Car } from "./vehicle";
import { carStep, toggleFlight } from "./vehicleFly";
import { createWalker, JUMP_BUFFER, STEP, stepWalk, type Walker } from "./walk";

export type PlayerState = "walk" | "enter" | "drive" | "fly" | "exit";

/** What the player meets. */
export interface PlayWorld {
  solids: Solids;
  /** The cars the player has had (its own, those taken from the traffic): left, they stand. */
  cars: Car[];
  traffic: Traffic | null;
  residents: Residents | null;
}

export interface Player {
  state: PlayerState;
  walker: Walker;
  /** The car being got into, driven or got out of; null on foot. */
  car: Car | null;
  /** Getting in or out, in the car's frame, and the seconds into it. */
  script: Script | null;
  t: number;
  /** A traffic car's driver getting out first, before the player's own `script`. */
  driver: Script | null;
  /** Out by the other door: the script is mirrored across the car. */
  mirror: boolean;
  /** Where the player stands once out. */
  spot: Spot;
  /** The camera's heading, `atan2(x, z)`: the walk is relative to it. */
  look: number;
}

/** A car this slow on the ground can be got out of, m/s. */
export const STILL = 1.5;

export function createPlayer(start: { x: number; z: number; yaw: number }, s: Solids): Player {
  const walker = createWalker(start, s);
  walker.face = start.yaw;
  return {
    state: "walk",
    walker,
    car: null,
    script: null,
    t: 0,
    driver: null,
    mirror: false,
    spot: { x: 0, z: 0 },
    look: start.yaw,
  };
}

const local = { x: 0, z: 0 };
const pose = makeScriptPose();

/** The player's way in from where they stand by `car`. */
function enterFrom(p: Player, car: Car): Script {
  const b = p.walker.body;
  return enterScript(toCar(b.x, b.z, car.x, car.z, car.yaw, local), p.walker.face - car.yaw);
}

/** Traffic car `i` off the roads, and in its place a car standing at its pose. */
export function takeFromTraffic(t: Traffic, i: number, s: Solids): Car {
  const c = createCar(t.x[i], t.z[i], t.heading[i], s, "player");
  c.y = s.heightAt(c.x, c.z, t.y[i] + CAR_CLIMB);
  t.live[i] = 0;
  return c;
}

/** E on foot: into the nearest car whose driver's door is within reach. */
function board(p: Player, w: PlayWorld) {
  const b = p.walker.body;
  const door = nearestDoor(b.x, b.y, b.z, w.cars, w.traffic);
  if (!door) return;
  let car = w.cars[door.index];
  if (door.kind === "traffic" && w.traffic) {
    car = takeFromTraffic(w.traffic, door.index, w.solids);
    w.cars.push(car);
    p.driver = exitScript(null);
  }
  setOwner(car, "player");
  p.walker.speed = 0;
  p.car = car;
  p.state = "enter";
  p.t = 0;
  p.script = p.driver ? null : enterFrom(p, car);
}

/** E in a car standing still on the ground: out, where there is room (see `exitSpot`). */
function leave(p: Player, car: Car, w: PlayWorld) {
  if (car.flying || car.vy !== 0 || Math.abs(car.vf) >= STILL) return;
  const side = exitSpot(car, w.solids, p.spot);
  if (!side) return;
  car.vx = car.vz = car.vf = car.steer = car.flyT = 0;
  p.mirror = side === "other";
  toCar(p.spot.x, p.spot.z, car.x, car.z, car.yaw, local);
  if (p.mirror) local.x = -local.x;
  p.script = side === "back" ? backScript(local) : exitScript(local);
  p.state = "exit";
  p.t = 0;
}

/** This frame's presses, once a frame (a frame may have no step or several). */
export function pressPlayer(p: Player, a: Actions, w: PlayWorld): void {
  const car = p.car;
  if (p.state === "walk") {
    if (a.jump) p.walker.buffer = JUMP_BUFFER;
    if (a.use && p.walker.grounded) board(p, w);
  } else if (car && (p.state === "drive" || p.state === "fly")) {
    if (a.fly) toggleFlight(car, w.solids);
    if (a.use) leave(p, car, w);
  }
}

/** Out of `car` at `p.spot`, on the car's level (under a deck, not up on it), facing away. */
function stepOut(p: Player, car: Car, s: Solids) {
  const { x, z } = p.spot;
  p.walker = createWalker({ x, z, y: s.heightAt(x, z, car.y + STEP) }, s);
  const yaw = poseAt(p.script!, p.script!.length, pose).yaw;
  p.walker.face = car.yaw + (p.mirror ? -yaw : yaw);
  setOwner(car, "empty");
  p.car = null;
  p.script = null;
  p.mirror = false;
  p.state = "walk";
}

/** One fixed step of `dt` seconds. */
export function stepPlayer(p: Player, a: Actions, dt: number, w: PlayWorld): void {
  const car = p.car;
  const s = w.solids;
  if (p.state === "walk" || !car) {
    const b = p.walker.body;
    stepWalk(p.walker, a, p.look, dt, s);
    // Pushed off the cars, then out of any wall or water that push put it into.
    for (const c of w.cars) collideBodies(b, c);
    if (w.cars.length) collideStatic(b, s, STEP, dt);
    return;
  }
  if (p.state === "drive" || p.state === "fly") {
    carStep(car, a, dt, s);
    const x = car.x;
    const z = car.z;
    for (const c of w.cars) if (c !== car) collideBodies(car, c);
    if (car.x !== x || car.z !== z) collideStatic(car, s, CAR_CLIMB, dt, CAR_SLOPE);
    p.state = car.flying ? "fly" : "drive";
    return;
  }
  p.t += dt;
  if (p.driver) {
    if (p.t < p.driver.length) return;
    // The driver is out by the door: from here on a resident, walking off.
    fromCar(CLIP.exit.x, CLIP.exit.z, car.x, car.z, car.yaw, local);
    w.residents?.join(local.x, local.z);
    p.driver = null;
    p.t = 0;
    p.script = enterFrom(p, car);
    return;
  }
  if (!p.script || p.t < p.script.length) return;
  if (p.state === "enter") {
    p.state = "drive";
    p.script = null;
    p.t = 0;
  } else stepOut(p, car, s);
}

/**
 * The player in the game scene: the walker's physics in fixed steps, its figure and the camera
 * over its shoulder drawn in between, and its own car parked where it starts, which it drives
 * and flies.
 */
import { Vector3, type PerspectiveCamera, type Scene } from "three";
import { collideBodies, collideStatic } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import { loadAssets } from "../render/assets";
import { carModel } from "../render/cars";
import type { CitySnapshot } from "../scene";
import { createCam, followCar, followWalker, turnCam, type CarView } from "./camera";
import { createCharacter, type Character } from "./character";
import type { Actions } from "./input";
import { spawnPoint } from "./spawn";
import { createCar, setOwner, type Car } from "./vehicle";
import { carStep, hoverBob, toggleFlight } from "./vehicleFly";
import { createWalker, gaitOf, JUMP_BUFFER, STEP, stepWalk, type Walker } from "./walk";

export interface Player {
  /** This frame's actions, once: the view turns at once, a jump press waits for the next step. */
  frame(a: Actions): void;
  step(a: Actions, dt: number): void;
  /** Puts the figure and `camera` `alpha` of the way past the last step; clips move on by `dt`. */
  draw(camera: PerspectiveCamera, alpha: number, dt: number): void;
  /** The feet (or the car) as last drawn. */
  readonly at: Vector3;
  dispose(): void;
}

// ponytail: a temporary way in and out of the car (E within `REACH` of it, out beside it at a
// standstill on the ground); Task 7 replaces it with the clips and the driver's door.
const REACH = 3;
const BESIDE = 2.4;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The pose of the car as drawn. */
interface CarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  pitch: number;
}

/** The car's nearest disc to (x, z) is within `REACH`. */
function near(car: Car, x: number, z: number): boolean {
  for (const off of car.discs) {
    const dx = car.x + Math.sin(car.yaw) * off - x;
    const dz = car.z + Math.cos(car.yaw) * off - z;
    if (Math.hypot(dx, dz) <= REACH) return true;
  }
  return false;
}

/** A walker beside the car: on its left if there is room, else on its right. */
function stepOut(car: Car, s: Solids): Walker {
  const lx = Math.cos(car.yaw);
  const lz = -Math.sin(car.yaw);
  const free = (x: number, z: number) => !s.isWater(x, z) && s.heightAt(x, z) <= car.y + STEP;
  const side = free(car.x + lx * BESIDE, car.z + lz * BESIDE) ? 1 : -1;
  const w = createWalker({ x: car.x + lx * BESIDE * side, z: car.z + lz * BESIDE * side }, s);
  w.face = car.yaw;
  return w;
}

/** The player on `solids`, the world's physics shared with everything else that moves. */
export function createPlayer(scene: Scene, city: CitySnapshot, solids: Solids): Player {
  const { world, graph } = city;
  const start = spawnPoint(world, graph, solids, world.focus);
  let walker = createWalker(start, solids);
  walker.face = start.yaw;
  const cam = createCam(start.yaw);
  const car: Car | null =
    start.car && createCar(start.car.x, start.car.z, start.car.yaw, solids, "empty");
  let driving = false;

  // The poses before and after the last step; frames are drawn in between.
  const before = { x: 0, y: 0, z: 0, face: 0 };
  const now = { x: 0, y: 0, z: 0, face: 0 };
  const keep = (p: typeof now) => {
    p.x = walker.body.x;
    p.y = walker.shownY;
    p.z = walker.body.z;
    p.face = walker.face;
  };
  keep(now);
  keep(before);
  const carBefore: CarPose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0 };
  const carNow: CarPose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0 };
  const keepCar = (p: CarPose) => {
    if (!car) return;
    p.x = car.x;
    p.y = car.y;
    p.z = car.z;
    p.yaw = car.yaw;
    p.roll = car.roll;
    p.pitch = car.pitch;
  };
  keepCar(carNow);
  keepCar(carBefore);
  const view: CarView = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    steer: 0,
    flying: false,
    flyT: 0,
  };
  const at = new Vector3();
  let ahead = false;

  let figure: Character | null = null;
  let parked: ReturnType<typeof carModel> | null = null;
  let disposed = false;
  loadAssets().then(
    (assets) => {
      if (disposed) return;
      figure = createCharacter(assets.walker);
      scene.add(figure.group);
      if (car) {
        parked = carModel(assets.car);
        // Yaw, then pitch, then the roll about the nose.
        parked.group.rotation.order = "YXZ";
        scene.add(parked.group);
      }
    },
    (e: unknown) => console.warn("The player's models did not load", e),
  );

  const getIn = (c: Car) => {
    driving = true;
    setOwner(c, "player");
    cam.pitch = 0.22;
    cam.idle = 2;
  };
  const getOut = (c: Car) => {
    driving = false;
    c.vx = c.vz = c.vf = c.steer = c.flyT = 0;
    setOwner(c, "empty");
    Object.assign(carBefore, carNow);
    walker = stepOut(c, solids);
    keep(now);
    keep(before);
    cam.yaw = walker.face;
    cam.pitch = 0.15;
  };

  return {
    at,
    frame(a) {
      turnCam(cam, a.look);
      if (car && driving) {
        if (a.fly) toggleFlight(car, solids);
        if (a.use && !car.flying && car.vy === 0 && Math.abs(car.vf) < 1.5) getOut(car);
        return;
      }
      if (car && a.use && walker.grounded && near(car, walker.body.x, walker.body.z)) {
        getIn(car);
        return;
      }
      if (a.jump) walker.buffer = JUMP_BUFFER;
      // Mostly away from the view, not sideways or back: the view may swing behind.
      ahead = a.move.y > 0.5 && a.move.y > 0.7 * Math.abs(a.move.x);
    },
    step(a, dt) {
      if (car && driving) {
        Object.assign(carBefore, carNow);
        carStep(car, a, dt, solids);
        keepCar(carNow);
        return;
      }
      Object.assign(before, now);
      stepWalk(walker, a, cam.heading.x, dt, solids);
      if (car) {
        // Pushed off the car, then out of any wall or water that push put it into.
        collideBodies(walker.body, car);
        collideStatic(walker.body, solids, STEP, dt);
      }
      keep(now);
    },
    draw(camera, alpha, dt) {
      if (car) {
        const y = lerp(carBefore.y, carNow.y, alpha) + hoverBob(car);
        const yaw = carBefore.yaw + wrap(carNow.yaw - carBefore.yaw) * alpha;
        view.x = lerp(carBefore.x, carNow.x, alpha);
        view.y = y;
        view.z = lerp(carBefore.z, carNow.z, alpha);
        view.yaw = yaw;
        parked?.group.position.set(view.x, y, view.z);
        parked?.group.rotation.set(
          lerp(carBefore.pitch, carNow.pitch, alpha),
          yaw,
          lerp(carBefore.roll, carNow.roll, alpha),
        );
      }
      if (car && driving) {
        view.vx = car.vx;
        view.vz = car.vz;
        view.steer = car.steer;
        view.flying = car.flying;
        view.flyT = car.flyT;
        followCar(cam, view, dt, solids);
        at.set(view.x, view.y, view.z);
      } else {
        at.set(
          before.x + (now.x - before.x) * alpha,
          before.y + (now.y - before.y) * alpha,
          before.z + (now.z - before.z) * alpha,
        );
        const face = before.face + wrap(now.face - before.face) * alpha;
        followWalker(cam, at, walker.speed, face, ahead, dt, solids);
        figure?.update(at.x, at.y, at.z, face, gaitOf(walker), walker.speed, dt);
      }
      if (figure) figure.group.visible = !driving;
      camera.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
      camera.lookAt(cam.at.x, cam.at.y, cam.at.z);
      if (Math.abs(camera.fov - cam.fov.x) > 1e-3) {
        camera.fov = cam.fov.x;
        camera.updateProjectionMatrix();
      }
    },
    dispose() {
      disposed = true;
      if (figure) scene.remove(figure.group);
      figure?.dispose();
      if (parked) scene.remove(parked.group);
      parked?.dispose();
    },
  };
}

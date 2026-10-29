/**
 * The player in the game scene: the walker's physics in fixed steps, its figure and the camera
 * over its shoulder drawn in between, and its own car parked where it starts.
 */
import { Vector3, type PerspectiveCamera, type Scene } from "three";
import { CAR_DISCS, CAR_RADIUS, collideBodies, collideStatic, type Body } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import { loadAssets } from "../render/assets";
import { carModel } from "../render/cars";
import type { CitySnapshot } from "../scene";
import { createCam, followWalker, turnCam } from "./camera";
import { createCharacter, type Character } from "./character";
import type { Actions } from "./input";
import { spawnPoint } from "./spawn";
import { createWalker, gaitOf, JUMP_BUFFER, STEP, stepWalk } from "./walk";

export interface Player {
  /** This frame's actions, once: the view turns at once, a jump press waits for the next step. */
  frame(a: Actions): void;
  step(a: Actions, dt: number): void;
  /** Puts the figure and `camera` `alpha` of the way past the last step; clips move on by `dt`. */
  draw(camera: PerspectiveCamera, alpha: number, dt: number): void;
  /** The feet as last drawn. */
  readonly at: Vector3;
  dispose(): void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The player on `solids`, the world's physics shared with everything else that moves. */
export function createPlayer(scene: Scene, city: CitySnapshot, solids: Solids): Player {
  const { world, graph } = city;
  const start = spawnPoint(world, graph, solids, world.focus);
  const walker = createWalker(start, solids);
  walker.face = start.yaw;
  const cam = createCam(start.yaw);
  const car: Body | null = start.car && {
    ...start.car,
    y: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    discs: CAR_DISCS,
    radius: CAR_RADIUS,
    mass: Infinity,
    flying: false,
  };

  // The pose before and after the last step; frames are drawn in between.
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
        parked.group.position.set(car.x, 0, car.z);
        parked.group.rotation.y = car.yaw;
        scene.add(parked.group);
      }
    },
    (e: unknown) => console.warn("The player's models did not load", e),
  );

  return {
    at,
    frame(a) {
      turnCam(cam, a.look);
      if (a.jump) walker.buffer = JUMP_BUFFER;
      // Mostly away from the view, not sideways or back: the view may swing behind.
      ahead = a.move.y > 0.5 && a.move.y > 0.7 * Math.abs(a.move.x);
    },
    step(a, dt) {
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
      at.set(
        before.x + (now.x - before.x) * alpha,
        before.y + (now.y - before.y) * alpha,
        before.z + (now.z - before.z) * alpha,
      );
      const face = before.face + wrap(now.face - before.face) * alpha;
      followWalker(cam, at, walker.speed, face, ahead, dt, solids);
      camera.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
      camera.lookAt(cam.at.x, cam.at.y, cam.at.z);
      if (Math.abs(camera.fov - cam.fov.x) > 1e-3) {
        camera.fov = cam.fov.x;
        camera.updateProjectionMatrix();
      }
      figure?.update(at.x, at.y, at.z, face, gaitOf(walker), walker.speed, dt);
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

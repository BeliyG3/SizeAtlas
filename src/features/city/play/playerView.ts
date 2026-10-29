/**
 * The player in the game scene: its states in fixed steps (see `player`), drawn in between: the
 * figure on foot, or getting in, sitting at the yoke and getting out of a car; the cars it has
 * had; and the camera over its shoulder or behind the car.
 */
import { Group, Vector3, type PerspectiveCamera, type Scene } from "three";
import type { Life } from "../panel/life";
import type { Solids } from "../physics/solids";
import { loadAssets, type Assets } from "../render/assets";
import type { CitySnapshot } from "../scene";
import { MODEL_SCALE } from "./boarding";
import { makeScriptPose, poseAt, SEATED, type ScriptPose } from "./boardingScript";
import { createCam, followCar, followWalker, turnCam, type CarView } from "./camera";
import { holdYoke } from "./carRig";
import { createCharacter, type Character } from "./character";
import type { Actions } from "./input";
import { createPlayer, pressPlayer, stepPlayer, type PlayWorld } from "./player";
import { createPlayerCars } from "./playerCars";
import { spawnPoint } from "./spawn";
import { createCar } from "./vehicle";
import { gaitOf } from "./walk";

export interface PlayerView {
  /** This frame's actions, once: the view turns at once, presses wait for no step. */
  frame(a: Actions): void;
  step(a: Actions, dt: number): void;
  /** Puts the figure and `camera` `alpha` of the way past the last step; clips move on by `dt`. */
  draw(camera: PerspectiveCamera, alpha: number, dt: number): void;
  /** The feet (or the car) as last drawn. */
  readonly at: Vector3;
  dispose(): void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A person in a car's frame: a holder mirrored across the car for its other door. */
interface Seated {
  figure: Character;
  holder: Group;
}

/** The player on `solids`, the world's physics, among `life`'s traffic and residents. */
export function createPlayerView(
  scene: Scene,
  city: CitySnapshot,
  solids: Solids,
  life: Life,
): PlayerView {
  const { world, graph } = city;
  const start = spawnPoint(world, graph, solids, world.focus);
  const p = createPlayer(start, solids);
  const actors = life.actors();
  const w: PlayWorld = {
    solids,
    cars: start.car ? [createCar(start.car.x, start.car.z, start.car.yaw, solids, "empty")] : [],
    traffic: actors?.traffic ?? null,
    residents: actors?.residents ?? null,
  };
  const cam = createCam(start.yaw);
  const cars = createPlayerCars(scene, w.cars);

  // The feet before and after the last step; frames are drawn in between.
  const before = { x: 0, y: 0, z: 0, face: 0 };
  const now = { x: 0, y: 0, z: 0, face: 0 };
  const keep = (k: typeof now) => {
    k.x = p.walker.body.x;
    k.y = p.walker.shownY;
    k.z = p.walker.body.z;
    k.face = p.walker.face;
  };
  keep(now);
  keep(before);
  const at = new Vector3();
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
  const pose = makeScriptPose();
  let ahead = false;

  let assets: Assets | null = null;
  let me: Seated | null = null;
  let driver: Seated | null = null;
  let disposed = false;
  const seat = (a: Assets): Seated => {
    const figure = createCharacter(a.walker);
    const holder = new Group();
    holder.add(figure.group);
    return { figure, holder };
  };
  loadAssets().then(
    (a) => {
      if (disposed) return;
      assets = a;
      me = seat(a);
      scene.add(me.figure.group);
    },
    (e: unknown) => console.warn("The player's models did not load", e),
  );

  /** `s` posed by `sp` in the frame of the car drawn at `i`, its holder mirrored if `mirror`. */
  const inCar = (s: Seated, i: number, sp: ScriptPose, mirror: boolean) => {
    const rig = cars.rig(i);
    if (!rig) return;
    if (s.holder.parent !== rig.model) rig.model.add(s.holder);
    if (s.figure.group.parent !== s.holder) s.holder.add(s.figure.group);
    s.holder.scale.x = mirror ? -1 : 1;
    const g = s.figure.group;
    g.position.set(sp.x, 0, sp.z);
    g.rotation.y = sp.yaw;
    g.scale.setScalar(1 / MODEL_SCALE + (1 - 1 / MODEL_SCALE) * sp.fit);
    s.figure.pose(sp);
    rig.door(sp.door);
    rig.model.parent?.updateMatrixWorld(true);
    // A mirrored arm is not the IK's: the hands let go there.
    if (!mirror) holdYoke(s.figure.arms, rig, sp.ik);
  };

  return {
    at,
    frame(a) {
      turnCam(cam, a.look);
      p.look = cam.heading.x;
      const was = p.state;
      pressPlayer(p, a, w);
      if (was === "walk" && p.state === "enter") {
        cars.boarded(p.car!);
        cam.pitch = 0.22;
        cam.idle = 2;
      }
      // Mostly away from the view, not sideways or back: the view may swing behind.
      ahead = a.move.y > 0.5 && a.move.y > 0.7 * Math.abs(a.move.x);
    },
    step(a, dt) {
      const was = p.state;
      if (was === "walk") Object.assign(before, now);
      stepPlayer(p, a, dt, w);
      cars.stepped(p.car);
      if (p.state === "walk") keep(now);
      if (was === "exit" && p.state === "walk") {
        Object.assign(before, now);
        cam.yaw = p.walker.face;
        cam.pitch = 0.15;
      }
    },
    draw(camera, alpha, dt) {
      if (assets) cars.models(assets);
      const car = p.car;
      cars.draw(car, alpha, view);
      const onFoot = p.state === "walk" || !car;
      let face = p.walker.face;
      if (onFoot) {
        at.set(
          before.x + (now.x - before.x) * alpha,
          before.y + (now.y - before.y) * alpha,
          before.z + (now.z - before.z) * alpha,
        );
        face = before.face + wrap(now.face - before.face) * alpha;
        followWalker(cam, at, p.walker.speed, face, ahead, dt, solids);
      } else {
        followCar(cam, view, dt, solids);
        at.set(view.x, view.y, view.z);
      }
      if (me) {
        const i = car ? w.cars.indexOf(car) : -1;
        // On foot, or waiting by a traffic car for its driver to get out.
        if (onFoot || p.driver) {
          if (me.figure.group.parent !== scene) scene.add(me.figure.group);
          me.figure.group.scale.setScalar(1);
          const b = p.walker.body;
          const x = onFoot ? at.x : b.x;
          const y = onFoot ? at.y : p.walker.shownY;
          const z = onFoot ? at.z : b.z;
          me.figure.update(x, y, z, face, gaitOf(p.walker), p.walker.speed, dt);
        } else {
          inCar(me, i, p.script ? poseAt(p.script, p.t, pose) : SEATED, p.mirror);
        }
        if (p.driver && car && assets) {
          driver ??= seat(assets);
          driver.holder.visible = true;
          inCar(driver, i, poseAt(p.driver, p.t, pose), false);
        } else if (driver) driver.holder.visible = false;
      }
      camera.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
      camera.lookAt(cam.at.x, cam.at.y, cam.at.z);
      if (Math.abs(camera.fov - cam.fov.x) > 1e-3) {
        camera.fov = cam.fov.x;
        camera.updateProjectionMatrix();
      }
    },
    dispose() {
      disposed = true;
      for (const s of [me, driver]) {
        s?.figure.group.removeFromParent();
        s?.holder.removeFromParent();
        s?.figure.dispose();
      }
      cars.dispose();
    },
  };
}

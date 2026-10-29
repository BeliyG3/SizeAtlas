/**
 * The cars the player has had, drawn: the one it is in between the physics steps, the others
 * standing where they were left; each a rigged model (see `carRig`).
 */
import type { Scene } from "three";
import type { Assets } from "../render/assets";
import { carModel } from "../render/cars";
import type { CarView } from "./camera";
import { rigCar, type CarRig } from "./carRig";
import type { Car } from "./vehicle";
import { hoverBob } from "./vehicleFly";

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The pose of a car as drawn. */
interface CarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  pitch: number;
}

const makePose = (): CarPose => ({ x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0 });
const keep = (k: CarPose, c: Car) => {
  k.x = c.x;
  k.y = c.y;
  k.z = c.z;
  k.yaw = c.yaw;
  k.roll = c.roll;
  k.pitch = c.pitch;
};

export function createPlayerCars(scene: Scene, cars: readonly Car[]) {
  const models: (ReturnType<typeof carModel> & { rig: CarRig })[] = [];
  // The car the player is in, before and after the last step.
  const before = makePose();
  const now = makePose();
  const shown = makePose();

  return {
    /** A model for each car that has none yet. */
    models(assets: Assets) {
      while (models.length < cars.length) {
        const m = carModel(assets.car);
        // Yaw, then pitch, then the roll about the nose.
        m.group.rotation.order = "YXZ";
        scene.add(m.group);
        models.push({ ...m, rig: rigCar(m.group.children[0]) });
      }
    },
    /** The rig of car `i`, null until its model is in. */
    rig: (i: number): CarRig | null => models[i]?.rig ?? null,
    /** The player is getting into `car`: it is drawn from where it stands. */
    boarded(car: Car) {
      keep(before, car);
      keep(now, car);
    },
    /** After a step: `car`, the one the player is in, as it is now. */
    stepped(car: Car | null) {
      if (!car) return;
      Object.assign(before, now);
      keep(now, car);
    },
    /** Draws each car, `active` `alpha` of the way past the last step, written to `view` too. */
    draw(active: Car | null, alpha: number, view: CarView) {
      for (let i = 0; i < models.length; i++) {
        const c = cars[i];
        const g = models[i].group;
        if (c === active) {
          shown.x = lerp(before.x, now.x, alpha);
          shown.y = lerp(before.y, now.y, alpha) + hoverBob(c);
          shown.z = lerp(before.z, now.z, alpha);
          shown.yaw = before.yaw + wrap(now.yaw - before.yaw) * alpha;
          shown.pitch = lerp(before.pitch, now.pitch, alpha);
          shown.roll = lerp(before.roll, now.roll, alpha);
          models[i].rig.steer(c.steer);
        } else keep(shown, c);
        g.position.set(shown.x, shown.y, shown.z);
        g.rotation.set(shown.pitch, shown.yaw, shown.roll);
      }
      if (!active) return;
      view.x = lerp(before.x, now.x, alpha);
      view.y = lerp(before.y, now.y, alpha) + hoverBob(active);
      view.z = lerp(before.z, now.z, alpha);
      view.yaw = before.yaw + wrap(now.yaw - before.yaw) * alpha;
      view.vx = active.vx;
      view.vz = active.vz;
      view.steer = active.steer;
      view.flying = active.flying;
      view.flyT = active.flyT;
    },
    dispose() {
      for (const m of models) {
        scene.remove(m.group);
        m.dispose();
      }
    },
  };
}

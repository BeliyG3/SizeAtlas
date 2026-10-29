/**
 * The cars the player has had, drawn: the one it is in between the physics steps, the others
 * standing where they were left; each a rigged model (see `carRig`), dropped with its car.
 */
import type { Scene } from "three";
import type { Assets } from "../render/assets";
import { carModel } from "../render/cars";
import { wrap, type CarView } from "./camera";
import { rigCar, type CarRig } from "./carRig";
import type { Car } from "./vehicle";
import { hoverBob } from "./vehicleFly";

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

type Model = ReturnType<typeof carModel> & { car: Car; rig: CarRig };

export function createPlayerCars(scene: Scene, cars: readonly Car[]) {
  const models: Model[] = [];
  // The car the player is in, before and after the last step, and as drawn.
  const before = makePose();
  const now = makePose();
  const shown = makePose();
  const rigOf = (car: Car): CarRig | null => {
    for (const m of models) if (m.car === car) return m.rig;
    return null;
  };
  const drop = (i: number) => {
    scene.remove(models[i].group);
    models[i].dispose();
    models.splice(i, 1);
  };

  return {
    /** A model for each car that has none yet; those of cars gone are dropped. */
    models(assets: Assets) {
      for (let i = models.length - 1; i >= 0; i--) if (!cars.includes(models[i].car)) drop(i);
      for (const car of cars) {
        if (rigOf(car)) continue;
        const m = carModel(assets.car);
        // Yaw, then pitch, then the roll about the nose.
        m.group.rotation.order = "YXZ";
        scene.add(m.group);
        models.push({ ...m, car, rig: rigCar(m.group.children[0]) });
      }
    },
    /** The rig of `car`, null until its model is in. */
    rig: rigOf,
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
      if (active) {
        shown.x = lerp(before.x, now.x, alpha);
        shown.y = lerp(before.y, now.y, alpha) + hoverBob(active);
        shown.z = lerp(before.z, now.z, alpha);
        shown.yaw = before.yaw + wrap(now.yaw - before.yaw) * alpha;
        shown.pitch = lerp(before.pitch, now.pitch, alpha);
        shown.roll = lerp(before.roll, now.roll, alpha);
        view.x = shown.x;
        view.y = shown.y;
        view.z = shown.z;
        view.yaw = shown.yaw;
        view.vx = active.vx;
        view.vz = active.vz;
        view.steer = active.steer;
        view.flying = active.flying;
        view.flyT = active.flyT;
      }
      for (const m of models) {
        const p = m.car === active ? shown : m.car;
        m.group.position.set(p.x, p.y, p.z);
        m.group.rotation.set(p.pitch, p.yaw, p.roll);
        if (m.car === active) m.rig.steer(m.car.steer);
      }
    },
    dispose() {
      for (let i = models.length - 1; i >= 0; i--) drop(i);
    },
  };
}

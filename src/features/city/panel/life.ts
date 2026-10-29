/**
 * The island's moving things in the panel: cars and residents on the road graph, drawn once the
 * models have loaded (the island shows without them until then).
 */
import type { Object3D, Vector3 } from "three";
import { localRadius } from "../actors/locals";
import { createResidents, type Residents } from "../actors/residents";
import { createTraffic, type Traffic } from "../actors/traffic";
import { loadAssets } from "../render/assets";
import { carInstances } from "../render/cars";
import { peopleInstances } from "../render/people";
import { trailMesh } from "../render/trails";
import type { RoadGraph } from "../world/roads";

/** The panel's limits: cars (flying ones included) and residents, however many islands. */
export const CARS = 200;
export const PEOPLE = 525;

/** Cars for an archipelago of `islands`: 60 an island, up to `CARS`. */
export function carsFor(islands: number): number {
  return Math.min(60 * Math.max(1, islands), CARS);
}

/** Residents for an archipelago of `islands`: 150 an island, up to `PEOPLE`. */
export function peopleFor(islands: number): number {
  return Math.min(150 * Math.max(1, islands), PEOPLE);
}

export interface Life {
  /** True once there are models to draw and people to move. */
  active: () => boolean;
  /**
   * New traffic and residents on `g` (null: none) of `islands`, the same for the same `seed`.
   */
  populate: (g: RoadGraph | null, seed: number, islands: number) => void;
  /**
   * Moves everyone on `dt` seconds. `eye` is the camera: near cars and figures are drawn as
   * models. They keep near `target`, the closer the camera the tighter.
   */
  step: (dt: number, eye: Vector3, target: Vector3) => void;
  dispose: () => void;
}

/** `onReady` runs once the models are in `parent`. */
export function createLife(parent: Object3D, onReady: () => void): Life {
  let models: {
    cars: ReturnType<typeof carInstances>;
    people: ReturnType<typeof peopleInstances>;
    trails: ReturnType<typeof trailMesh>;
  } | null = null;
  let pools: { traffic: Traffic; residents: Residents } | null = null;
  let disposed = false;
  // Hidden from a new island until its first step, so no car of the last one shows on it.
  const show = (visible: boolean) => {
    if (!models) return;
    models.cars.group.visible = models.people.group.visible = visible;
    models.trails.mesh.visible = visible;
  };

  loadAssets().then(
    (assets) => {
      if (disposed) return;
      const cars = carInstances(assets.car, CARS);
      models = {
        cars,
        people: peopleInstances(assets.walker, PEOPLE),
        trails: trailMesh(CARS, cars.tail),
      };
      show(false);
      parent.add(models.cars.group, models.people.group, models.trails.mesh);
      onReady();
    },
    // ponytail: without its models the island stays still; the next panel tries again.
    () => {},
  );

  return {
    active: () => models !== null && pools !== null,
    populate(g, seed, islands) {
      pools = g && {
        traffic: createTraffic(g, carsFor(islands), seed),
        residents: createResidents(g, peopleFor(islands), seed),
      };
      show(false);
    },
    step(dt, eye, target) {
      if (!models || !pools) return;
      const around = { x: target.x, z: target.z, r: localRadius(eye.distanceTo(target)) };
      pools.traffic.update(dt, around);
      pools.residents.update(dt, around);
      models.cars.update(pools.traffic, eye);
      models.trails.update(pools.traffic, eye, dt);
      models.people.update(pools.residents, eye);
      show(true);
    },
    dispose() {
      disposed = true;
      if (!models) return;
      parent.remove(models.cars.group, models.people.group, models.trails.mesh);
      models.cars.dispose();
      models.trails.dispose();
      models.people.dispose();
      models = null;
    },
  };
}

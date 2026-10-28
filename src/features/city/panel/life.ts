/**
 * The island's moving things in the panel: cars and residents on the road graph, drawn once the
 * models have loaded (the island shows without them until then).
 */
import type { Object3D, Vector3 } from "three";
import { createResidents, type Residents } from "../actors/residents";
import { createTraffic, type Traffic } from "../actors/traffic";
import { loadAssets } from "../render/assets";
import { carInstances } from "../render/cars";
import { peopleInstances } from "../render/people";
import type { RoadGraph } from "../world/roads";

/** The panel's limits: cars (flying ones included) and residents. */
export const CARS = 60;
export const PEOPLE = 150;

export interface Life {
  /** True once there are models to draw and people to move. */
  active: () => boolean;
  /** New traffic and residents on `g` (null: none), the same for the same `seed`. */
  populate: (g: RoadGraph | null, seed: number) => void;
  /** Moves everyone on `dt` seconds; `eye` is the camera, near figures are drawn as models. */
  step: (dt: number, eye: Vector3) => void;
  dispose: () => void;
}

/** `onReady` runs once the models are in `parent`. */
export function createLife(parent: Object3D, onReady: () => void): Life {
  let models: {
    cars: ReturnType<typeof carInstances>;
    people: ReturnType<typeof peopleInstances>;
  } | null = null;
  let pools: { traffic: Traffic; residents: Residents } | null = null;
  let disposed = false;
  // Hidden from a new island until its first step, so no car of the last one shows on it.
  const show = (visible: boolean) => {
    if (models) models.cars.group.visible = models.people.group.visible = visible;
  };

  loadAssets().then(
    (assets) => {
      if (disposed) return;
      models = {
        cars: carInstances(assets.car, CARS),
        people: peopleInstances(assets.walker, PEOPLE),
      };
      show(false);
      parent.add(models.cars.group, models.people.group);
      onReady();
    },
    // ponytail: without its models the island stays still; the next panel tries again.
    () => {},
  );

  return {
    active: () => models !== null && pools !== null,
    populate(g, seed) {
      pools = g && {
        traffic: createTraffic(g, CARS, seed),
        residents: createResidents(g, PEOPLE, seed),
      };
      show(false);
    },
    step(dt, eye) {
      if (!models || !pools) return;
      pools.traffic.update(dt);
      pools.residents.update(dt);
      models.cars.update(pools.traffic);
      models.people.update(pools.residents, eye);
      show(true);
    },
    dispose() {
      disposed = true;
      if (!models) return;
      parent.remove(models.cars.group, models.people.group);
      models.cars.dispose();
      models.people.dispose();
      models = null;
    },
  };
}

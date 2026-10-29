import { describe, expect, it } from "vitest";
import { standingCars } from "../actors/traffic.fixture";
import { BOUNCE, CAR_DISCS } from "../physics/bodies";
import { canalWorld } from "../physics/world.fixture";
import { makeActions } from "./input";
import { createObstacles, fillObstacles, trafficBodies } from "./obstacles";
import { createPlayer, stepPlayer, type PlayWorld } from "./player";
import { createCar } from "./vehicle";

describe("trafficBodies", () => {
  it("the cars within 60 m, as the same bodies in the same list every call", () => {
    const t = standingCars([
      [0, 0],
      [59, 0],
      [0, 61],
      [10, 10],
    ]);
    t.live[3] = 0; // taken by the player
    const near = trafficBodies(t, { x: 0, z: 0 });
    expect(near.map((b) => b.x)).toEqual([0, 59]);
    expect(near.every((b) => b.mass === Infinity)).toBe(true);
    const bodies = [...near];
    t.x[1] = 70;
    const again = trafficBodies(t, { x: 0, z: 0 });
    expect(again).toBe(near);
    expect(again).toEqual([bodies[0]]);
    t.x[1] = 50;
    expect(trafficBodies(t, { x: 0, z: 0 })[1]).toBe(bodies[1]);
  });

  it("a player's car driving into a traffic car at 15 m/s bounces off; the traffic car stays", () => {
    const { solids } = canalWorld();
    const t = standingCars([[40, 30]]);
    const w: PlayWorld = { solids, cars: [], traffic: t, residents: null };
    const p = createPlayer({ x: 40, z: 10, yaw: 0 }, solids);
    const car = createCar(40, 20, 0, solids, "player");
    w.cars.push(car);
    p.car = car;
    p.state = "drive";
    car.vz = car.vf = 15;
    let before = 15;
    for (let i = 0; i < 60 && car.vz > 0; i++) {
      before = car.vz;
      stepPlayer(p, makeActions(), 1 / 60, w);
    }
    // The speed into it, back the other way by `BOUNCE` of it: a change of 15 × 1.3.
    expect(before - car.vz).toBeCloseTo(before * (1 + BOUNCE), 0);
    expect(car.vz).toBeLessThan(-4);
    expect([t.x[0], t.z[0]]).toEqual([40, 30]);
  });
});

describe("fillObstacles", () => {
  it("a point a disc of each car, and the person on foot", () => {
    const { solids } = canalWorld();
    const o = createObstacles(2);
    const car = createCar(40, 20, Math.PI / 2, solids, "empty");
    const walker = createPlayer({ x: 10, z: 5, yaw: 0 }, solids).walker.body;
    fillObstacles(o, [car], walker);
    expect(o.count).toBe(CAR_DISCS.length + 1);
    expect(Array.from(o.x.subarray(0, o.count))).toEqual([...CAR_DISCS.map((d) => 40 + d), 10]);
    expect(o.r[o.count - 1]).toBe(walker.radius);
    expect(fillObstacles(o, [car], null).count).toBe(CAR_DISCS.length);
  });
});

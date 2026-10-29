import { describe, expect, it } from "vitest";
import { CAR_CLIMB, HEADROOM } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import { bridgeWorld, canalWorld } from "../physics/world.fixture";
import { deckLift } from "../world/bridgeChains";
import { makeActions, type Actions } from "./input";
import { CAR, createCar, driveStep, type Car } from "./vehicle";

const DT = 1 / 60;
const EAST = Math.PI / 2;

/** A car at (x, z) nose along `yaw`, moving at `speed` m/s. */
function moving(s: Solids, x: number, z: number, yaw: number, speed: number): Car {
  const c = createCar(x, z, yaw, s, "player");
  c.vx = Math.sin(yaw) * speed;
  c.vz = Math.cos(yaw) * speed;
  c.vf = speed;
  return c;
}

function drive(c: Car, a: Actions, s: Solids, seconds: number, each = () => {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    driveStep(c, a, DT, s);
    each();
  }
}

describe("driveStep", () => {
  it("steering right turns the car right", () => {
    const { solids } = canalWorld();
    // Nose to -z: its right is +x.
    const c = moving(solids, 40, 80, Math.PI, 10);
    const a = makeActions();
    a.steer = 1;
    a.throttle = 0.3;
    drive(c, a, solids, 1);
    expect(c.x).toBeGreaterThan(41);
    expect(c.z).toBeLessThan(80);
    // The nose swung toward +x too: a right turn is a falling yaw.
    expect(c.yaw).toBeLessThan(Math.PI);
    const left = moving(solids, 40, 80, Math.PI, 10);
    a.steer = -1;
    drive(left, a, solids, 1);
    expect(left.x).toBeLessThan(39);
  });

  it("full throttle for 5 s on the straight stays under the top speed", () => {
    const { solids } = canalWorld();
    const c = createCar(5, 20, EAST, solids, "player");
    const a = makeActions();
    a.throttle = 1;
    let top = 0;
    drive(c, a, solids, 5, () => (top = Math.max(top, Math.hypot(c.vx, c.vz))));
    expect(top).toBeLessThanOrEqual(CAR.top);
    expect(top).toBeGreaterThan(20);
  });

  it("the brake stops the car from 10 m/s without backing it up; held on from rest, it reverses", () => {
    const { solids } = canalWorld();
    const c = moving(solids, 20, 20, EAST, 10);
    const a = makeActions();
    a.brake = 1;
    let steps = 0;
    while (c.vf > 0 && steps < 120) {
      driveStep(c, a, DT, solids);
      expect(c.vf).toBeGreaterThanOrEqual(0);
      steps++;
    }
    expect(c.vf).toBe(0);
    expect(steps).toBeLessThan(60);
    drive(c, a, solids, 4);
    expect(c.vf).toBeLessThan(0);
    expect(-c.vf).toBeLessThanOrEqual(CAR.reverse);
  });

  it("rolls to a stop off the throttle and does not roll back", () => {
    const { solids } = canalWorld();
    const c = moving(solids, 20, 20, EAST, 3);
    drive(c, makeActions(), solids, 8);
    expect(c.vf).toBe(0);
    expect(c.vx).toBeCloseTo(0);
  });

  it("drives from island to island over the bridge, its height on the deck", () => {
    const { solids } = bridgeWorld();
    const c = createCar(70, 50, EAST, solids, "player");
    const a = makeActions();
    a.throttle = 1;
    let top = 0;
    let steps = 0;
    while (c.x < 240 && steps < 60 * 60) {
      driveStep(c, a, DT, solids);
      expect(solids.isWater(c.x, c.z, c.y + HEADROOM)).toBe(false);
      expect(c.y).toBeCloseTo(solids.heightAt(c.x, c.z, c.y + CAR_CLIMB));
      top = Math.max(top, c.y);
      steps++;
    }
    // At the second island's gate.
    expect(c.x).toBeGreaterThanOrEqual(240);
    expect(c.z).toBeCloseTo(50, 0);
    expect(top).toBeCloseTo(deckLift(0));
  });

  it("driven off a roof's edge, it falls to the street", () => {
    const { solids } = canalWorld([{ x: 20, z: 20, w: 20, d: 20, h: 10 }]);
    const c = moving(solids, 30, 30, EAST, 8);
    expect(c.y).toBe(10);
    let lowest = 10;
    drive(c, makeActions(), solids, 3, () => {
      lowest = Math.min(lowest, c.y);
      expect(c.y).toBeGreaterThanOrEqual(0);
    });
    expect(c.x).toBeGreaterThan(40);
    expect(c.y).toBe(0);
    expect(lowest).toBe(0);
  });
});

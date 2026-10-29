import { describe, expect, it } from "vitest";
import { canalWorld } from "../physics/world.fixture";
import { CAM, CHASE, createCam, damp, followCar, followWalker, turnCam } from "./camera";

const DT = 1 / 60;
const EAST = Math.PI / 2;
const feet = { x: 50, y: 0, z: 50 };

/** `seconds` of frames following the walker standing at `feet`. */
function settle(
  c: ReturnType<typeof createCam>,
  solids: ReturnType<typeof canalWorld>["solids"],
  seconds = 2,
) {
  for (let i = 0; i < seconds / DT; i++) followWalker(c, feet, 0, EAST, false, DT, solids);
}
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("damp", () => {
  it("settles on the target without overshoot", () => {
    const s = { x: 0, v: 0 };
    let most = 0;
    for (let i = 0; i < 120; i++) most = Math.max(most, damp(s, 1, 0.2, DT));
    expect(s.x).toBeCloseTo(1, 3);
    expect(most).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("followWalker", () => {
  it("stands behind and over the shoulder in the open", () => {
    const { solids } = canalWorld();
    const c = createCam(EAST);
    settle(c, solids);
    // Behind (toward -x), the shoulder to the right of the view (+z).
    expect(c.eye.x).toBeLessThan(feet.x - 2);
    expect(c.eye.z).toBeCloseTo(feet.z + CAM.shoulder, 2);
    expect(flat(c.eye, feet)).toBeGreaterThan(CAM.dist - 0.1);
    expect(c.fov.x).toBeCloseTo(CAM.fov, 3);
  });

  it("comes in closer than 1 m against a wall 1 m behind, and stays out of the house", () => {
    const { solids } = canalWorld([{ x: 30, z: 30, w: 19, d: 40, h: 20 }]);
    const c = createCam(EAST);
    settle(c, solids);
    expect(flat(c.eye, feet)).toBeLessThan(1);
    expect(solids.roofAt(c.eye.x, c.eye.z)).toBeNull();
  });

  it("narrows the shoulder against a wall at its side", () => {
    // A wall 0.3 m to the right of the view.
    const { solids } = canalWorld([{ x: 30, z: 50.3, w: 40, d: 20, h: 20 }]);
    const c = createCam(EAST);
    settle(c, solids);
    expect(c.eye.z).toBeLessThan(feet.z + 0.05);
    expect(solids.roofAt(c.eye.x, c.eye.z)).toBeNull();
  });

  it("swings back behind a walker moving away after 1.5 s without a turn", () => {
    const { solids } = canalWorld();
    const c = createCam(EAST);
    turnCam(c, { x: 0.5, y: 0 });
    for (let i = 0; i < 60; i++) followWalker(c, feet, 1.4, EAST, true, DT, solids);
    expect(c.yaw).toBeCloseTo(EAST - 0.5, 6);
    for (let i = 0; i < 600; i++) followWalker(c, feet, 1.4, EAST, true, DT, solids);
    expect(Math.abs(c.yaw - EAST)).toBeLessThan(0.05);
  });

  it("pulls back and widens when sprinting", () => {
    const { solids } = canalWorld();
    const c = createCam(EAST);
    for (let i = 0; i < 180; i++) followWalker(c, feet, 6, EAST, false, DT, solids);
    expect(flat(c.eye, feet)).toBeGreaterThan(CAM.dist + 0.8);
    expect(c.fov.x).toBeCloseTo(CAM.fov + 5, 1);
  });
});

describe("followCar", () => {
  it("chases some 7 m behind a parked car", () => {
    const { solids } = canalWorld();
    const c = createCam(EAST);
    const car = { x: 50, y: 0, z: 50, yaw: EAST, vx: 0, vz: 0, steer: 0, flying: false, flyT: 0 };
    for (let i = 0; i < 300; i++) followCar(c, car, DT, solids);
    const back = Math.hypot(c.eye.x - c.pivot.x.x, c.eye.y - c.pivot.y.x, c.eye.z - c.pivot.z.x);
    expect(back).toBeCloseTo(CHASE.dist, 3);
    expect(c.eye.x).toBeLessThan(car.x - 6);
    expect(c.at.x).toBeGreaterThan(car.x);
  });
});

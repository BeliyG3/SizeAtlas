import { describe, expect, it } from "vitest";
import { canalWorld, type House } from "../physics/world.fixture";
import { makeActions, type Actions } from "./input";
import { createWalker, GAIT, gaitOf, JUMP_H, stepWalk, type Walker } from "./walk";

const DT = 1 / 60;
/** The camera looks toward +x. */
const EAST = Math.PI / 2;

/** Runs `seconds` of steps with `a` (a press is held for the first step only); the highest feet. */
function run(
  w: Walker,
  a: Actions,
  seconds: number,
  solids: ReturnType<typeof canalWorld>["solids"],
) {
  let peak = w.body.y;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWalk(w, a, EAST, DT, solids);
    a.jump = false;
    peak = Math.max(peak, w.body.y);
  }
  return peak;
}

const forward = (sprint = false) => {
  const a = makeActions();
  a.move.y = 1;
  a.sprint = sprint;
  return a;
};

describe("stepWalk", () => {
  it("W for a second walks ~1.4 m the camera's way", () => {
    const { solids } = canalWorld();
    const w = createWalker({ x: 20, z: 20 }, solids);
    run(w, forward(), 1, solids);
    expect(w.body.x - 20).toBeGreaterThan(1.2);
    expect(w.body.x - 20).toBeLessThan(1.45);
    expect(Math.abs(w.body.z - 20)).toBeLessThan(1e-6);
    expect(gaitOf(w)).toBe("walk");
  });

  it("Shift sprints at ~6 m/s", () => {
    const { solids } = canalWorld();
    const w = createWalker({ x: 10, z: 20 }, solids);
    run(w, forward(true), 1, solids);
    expect(w.speed).toBeCloseTo(GAIT.sprint, 5);
    expect(gaitOf(w)).toBe("sprint");
  });

  it("a stick tilted past 0.8 jogs, a light tilt walks slower", () => {
    const { solids } = canalWorld();
    const tilt = (y: number) => {
      const w = createWalker({ x: 10, z: 20 }, solids);
      const a = makeActions();
      a.move.y = y;
      a.analog = true;
      run(w, a, 1, solids);
      return w.speed;
    };
    expect(tilt(1)).toBeCloseTo(GAIT.jog, 5);
    expect(tilt(0.4)).toBeCloseTo(GAIT.walk / 2, 5);
  });

  const step = (h: number): House => ({ x: 21, z: 10, w: 10, d: 20, h });

  it("walks up a 0.4 m step", () => {
    const { solids } = canalWorld([step(0.4)]);
    const w = createWalker({ x: 20, z: 20 }, solids);
    run(w, forward(), 2, solids);
    expect(w.body.x).toBeGreaterThan(22);
    expect(w.body.y).toBeCloseTo(0.4, 6);
  });

  it("stops at a 0.6 m step: a wall", () => {
    const { solids } = canalWorld([step(0.6)]);
    const w = createWalker({ x: 20, z: 20 }, solids);
    run(w, forward(), 2, solids);
    expect(w.body.x).toBeLessThan(21);
    expect(w.body.y).toBe(0);
  });

  it("a standing jump peaks at 1.2 m and lands", () => {
    const { solids } = canalWorld();
    const w = createWalker({ x: 20, z: 20 }, solids);
    const a = makeActions();
    a.jump = true;
    const peak = run(w, a, 1.5, solids);
    expect(peak).toBeGreaterThan(JUMP_H - 0.05);
    expect(peak).toBeLessThan(JUMP_H + 0.05);
    expect(w.grounded).toBe(true);
    expect(w.body.y).toBe(0);
  });

  it("a press just before landing still jumps", () => {
    const { solids } = canalWorld();
    const w = createWalker({ x: 20, z: 20 }, solids);
    const a = makeActions();
    a.jump = true;
    run(w, a, 0.62, solids); // 0.69 s in the air: the next press comes 70 ms early
    expect(w.grounded).toBe(false);
    a.jump = true;
    run(w, a, 0.2, solids);
    expect(w.body.y).toBeGreaterThan(0.3);
  });

  it("drops off a 2 m ledge", () => {
    const { solids } = canalWorld([{ x: 10, z: 10, w: 10, d: 20, h: 2 }]);
    const w = createWalker({ x: 18, z: 20 }, solids);
    expect(w.body.y).toBe(2);
    run(w, forward(), 3, solids);
    expect(w.body.x).toBeGreaterThan(21);
    expect(w.body.y).toBe(0);
    expect(w.grounded).toBe(true);
  });

  it("does not walk or jump off a 20 m roof: its edge is a wall", () => {
    const { solids } = canalWorld([{ x: 10, z: 10, w: 10, d: 20, h: 20 }]);
    const w = createWalker({ x: 18, z: 20 }, solids);
    run(w, forward(true), 3, solids);
    expect(w.body.y).toBe(20);
    expect(w.body.x).toBeLessThan(20);
    const a = forward(true);
    a.jump = true;
    run(w, a, 2, solids);
    expect(w.body.y).toBe(20);
    expect(w.body.x).toBeLessThan(20);
  });

  it("slides along a roof's edge when walking at it slantwise", () => {
    const { solids } = canalWorld([{ x: 10, z: 10, w: 10, d: 20, h: 20 }]);
    const w = createWalker({ x: 19, z: 15 }, solids);
    const a = makeActions();
    a.move.x = 0.6; // right of east: toward +z
    a.move.y = 0.8;
    run(w, a, 2, solids);
    expect(w.body.x).toBeLessThan(20);
    expect(w.body.z).toBeGreaterThan(16);
    expect(w.body.y).toBe(20);
  });
});

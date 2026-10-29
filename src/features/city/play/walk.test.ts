import { describe, expect, it } from "vitest";
import { createSolids, type Solids } from "../physics/solids";
import { canalWorld, rect, type House } from "../physics/world.fixture";
import { buildWorld } from "../world/buildings";
import { POLY, ROAD } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { makeActions, type Actions } from "./input";
import { createWalker, GAIT, gaitOf, JUMP_BUFFER, JUMP_H, stepWalk, type Walker } from "./walk";

const DT = 1 / 60;
/** The camera looks toward +x. */
const EAST = Math.PI / 2;

/** Runs `seconds` of steps with `a`, `jump` pressed before the first; the highest feet. */
function run(w: Walker, a: Actions, seconds: number, solids: Solids, jump = false) {
  if (jump) w.buffer = JUMP_BUFFER;
  let peak = w.body.y;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWalk(w, a, EAST, DT, solids);
    peak = Math.max(peak, w.body.y);
  }
  return peak;
}

/** A 200 × 100 m island with a street's deck `lift` metres over its land, along z at x = 60. */
function deckWorld(lift: number): Solids {
  const map = mapOf([rect(POLY.island, 1, 0, 0, 200, 100)], {
    width: 200,
    height: 100,
    nodes: new Float32Array([60, 20, 60, 80]),
    edges: [{ a: 0, b: 1, cls: ROAD.street, bridge: true, liftA: lift, liftB: lift }],
  });
  const g = buildRoads(map);
  return createSolids(buildWorld(map, null), g);
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
    const peak = run(w, makeActions(), 1.5, solids, true);
    expect(peak).toBeGreaterThan(JUMP_H - 0.05);
    expect(peak).toBeLessThan(JUMP_H + 0.05);
    expect(w.grounded).toBe(true);
    expect(w.body.y).toBe(0);
  });

  it("a press just before landing still jumps", () => {
    const { solids } = canalWorld();
    const w = createWalker({ x: 20, z: 20 }, solids);
    const a = makeActions();
    run(w, a, 0.62, solids, true); // 0.69 s in the air: the next press comes 70 ms early
    expect(w.grounded).toBe(false);
    run(w, a, 0.2, solids, true);
    expect(w.body.y).toBeGreaterThan(0.3);
  });

  it("drops off a deck's side 2 m over land", () => {
    const solids = deckWorld(2);
    const w = createWalker({ x: 60, z: 50 }, solids);
    expect(w.body.y).toBe(2);
    run(w, forward(), 6, solids);
    expect(w.body.x).toBeGreaterThan(66);
    expect(w.body.y).toBe(0);
    expect(w.grounded).toBe(true);
  });

  it("does not drop off a deck 3.5 m over land", () => {
    const solids = deckWorld(3.5);
    const w = createWalker({ x: 60, z: 50 }, solids);
    run(w, forward(), 6, solids);
    expect(w.body.x).toBeLessThan(65);
    expect(w.body.y).toBe(3.5);
  });

  it("does not leave a 12 m roof for a 10 m one beside it: roofs are left by car", () => {
    const { solids } = canalWorld([
      { x: 10, z: 10, w: 10, d: 20, h: 12 },
      { x: 20, z: 10, w: 10, d: 20, h: 10 },
    ]);
    const w = createWalker({ x: 18, z: 20 }, solids);
    run(w, forward(), 3, solids);
    expect(w.body.x).toBeLessThan(20);
    expect(w.body.y).toBe(12);
    run(w, forward(true), 2, solids, true);
    expect(w.body.x).toBeLessThan(20);
    expect(w.body.y).toBe(12);
  });

  it("does not walk or jump off a 20 m roof: its edge is a wall", () => {
    const { solids } = canalWorld([{ x: 10, z: 10, w: 10, d: 20, h: 20 }]);
    const w = createWalker({ x: 18, z: 20 }, solids);
    run(w, forward(true), 3, solids);
    expect(w.body.y).toBe(20);
    expect(w.body.x).toBeLessThan(20);
    run(w, forward(true), 2, solids, true);
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

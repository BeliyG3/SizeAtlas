import { describe, expect, it } from "vitest";
import { canalWorld } from "../physics/world.fixture";
import { BESIDE, canBoard, exitSpot } from "./boarding";
import { createCar } from "./vehicle";

const EAST = Math.PI / 2;
/** A 40 m house at x 20…40, z 20…40. */
const TOWER = { x: 20, z: 20, w: 20, d: 20, h: 40 };

describe("canBoard", () => {
  it("reaches a car nearby on its level, not one on a roof overhead", () => {
    const { solids } = canalWorld([TOWER]);
    const street = createCar(60, 60, EAST, solids, "empty");
    expect(canBoard(street, 60, 0, 62)).toBe(true);
    expect(canBoard(street, 60, 0, 66)).toBe(false);
    // On the roof by its edge, the player on the street just below.
    const roof = createCar(39, 30, 0, solids, "empty");
    expect(roof.y).toBe(40);
    expect(canBoard(roof, 41, 0, 30)).toBe(false);
    expect(canBoard(roof, 37, 40, 30)).toBe(true);
  });
});

describe("exitSpot", () => {
  const out = { x: 0, z: 0 };

  it("steps out on its left: +x for a car nosed to +z", () => {
    const { solids } = canalWorld();
    const c = createCar(60, 60, 0, solids, "player");
    expect(exitSpot(c, solids, out)).toBe(true);
    expect(out.x).toBeCloseTo(60 + BESIDE);
    expect(out.z).toBeCloseTo(60);
  });

  it("on a roof by its edge, steps out on the roof side, never down to the street", () => {
    const { solids } = canalWorld([TOWER]);
    // Nose to +z at x = 38.5: its left (+x) is past the edge at x = 40.
    const c = createCar(38.5, 30, 0, solids, "player");
    expect(exitSpot(c, solids, out)).toBe(true);
    expect(out.x).toBeCloseTo(38.5 - BESIDE);
    expect(solids.heightAt(out.x, out.z)).toBe(40);
  });

  it("with water on one side and a house on the other, stays in", () => {
    // On the canal bridge (deck at 1 m, z 45…55) by its south edge, a house on its north side.
    const { solids } = canalWorld([{ x: 95, z: 47.5, w: 10, d: 5, h: 20 }]);
    // Nose to +x: the left is -z (past the deck's edge, water), the right +z (the house).
    const c = createCar(100, 46, EAST, solids, "player");
    expect(c.y).toBeCloseTo(1);
    expect(exitSpot(c, solids, out)).toBe(false);
    // Without the house it steps out on the deck, on its right.
    const open = canalWorld().solids;
    expect(exitSpot(createCar(100, 46, EAST, open, "player"), open, out)).toBe(true);
    expect(out.z).toBeCloseTo(46 + BESIDE);
  });

  it("does not step out into a taller house beside it", () => {
    const { solids } = canalWorld([
      { x: 50, z: 61.5, w: 20, d: 10, h: 6 },
      { x: 50, z: 48.5, w: 20, d: 10, h: 6 },
    ]);
    const c = createCar(60, 60, 0, solids, "player");
    expect(exitSpot(c, solids, out)).toBe(true);
    const boxed = createCar(60, 60, EAST, solids, "player");
    expect(exitSpot(boxed, solids, out)).toBe(false);
  });
});

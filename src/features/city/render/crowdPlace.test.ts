import { describe, expect, it } from "vitest";
import { CAR_LENGTH } from "./cars";
import { line } from "./crowd.fixture";
import { CROWD_FADE, crowdAt, crowdShow } from "./crowdPlace";

describe("crowdAt", () => {
  const r = line();

  it("moves a particle along its route at its speed", () => {
    const a = crowdAt(r, 0, 10, 5, 0, 2);
    const b = crowdAt(r, 0, 10, 5, 0, 3);
    expect([a.x, a.y, a.z]).toEqual([20, 1, 0]);
    expect(b.x - a.x).toBeCloseTo(5);
    expect([a.dx, a.dz]).toEqual([1, 0]);
  });

  it("keeps the route's offset right of the way (side 1) or left (-1), there and back", () => {
    // Going east the right is +z; coming back west, -z.
    expect(crowdAt(r, 0, 50, 1, 1, 0)).toMatchObject({ x: 50, z: 3 });
    expect(crowdAt(r, 0, 50, 1, -1, 0)).toMatchObject({ x: 50, z: -3 });
    const back = crowdAt(r, 0, 350, 1, 1, 0);
    expect(back.x).toBeCloseTo(50);
    expect(back.z).toBe(-3);
    expect(back.dx).toBe(-1);
  });

  it("puts a light half a car ahead or behind, on the way it heads", () => {
    const h = CAR_LENGTH / 2;
    expect(crowdAt(r, 0, 50, 1, 1, 0, h)).toMatchObject({ x: 50 + h, z: 3 });
    expect(crowdAt(r, 0, 50, 1, 1, 0, -h)).toMatchObject({ x: 50 - h, z: 3 });
    // Coming back west, ahead is -x.
    expect(crowdAt(r, 0, 350, 1, 1, 0, h).x).toBeCloseTo(50 - h);
  });

  it("comes back to where it was after the route's length", () => {
    const a = crowdAt(r, 0, 37, 1.3, -1, 11);
    const b = crowdAt(r, 0, 37, 1.3, -1, 11 + 400 / 1.3);
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.z).toBeCloseTo(a.z, 3);
  });
});

describe("crowdShow", () => {
  it("hides a particle inside the circle and grows it in by the fade's edge", () => {
    expect([0, 100, 199.9].map((d) => crowdShow(d, 200))).toEqual([0, 0, 0]);
    expect([CROWD_FADE * 200, 300, 5000].map((d) => crowdShow(d, 200))).toEqual([1, 1, 1]);
    const mid = crowdShow(215, 200);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

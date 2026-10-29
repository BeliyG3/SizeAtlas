import { describe, expect, it } from "vitest";
import type { Solids } from "../physics/solids";
import { HEADROOM } from "../physics/bodies";
import { bridgeWorld, canalWorld } from "../physics/world.fixture";
import { deckLift } from "../world/bridgeChains";
import { makeActions, type Actions } from "./input";
import { CAR, createCar, driveStep, type Car } from "./vehicle";
import { carStep, HOVER, hoverBob, MAX_ROLL, toggleFlight } from "./vehicleFly";

const DT = 1 / 60;
const EAST = Math.PI / 2;
/** A 40 m house at x 20…40, z 20…40, west of the canal (x 90…110). */
const TOWER = { x: 20, z: 20, w: 20, d: 20, h: 40 };

/** A car in the air at (x, y, z), nose along `yaw`, at `speed` m/s. */
function flying(s: Solids, x: number, y: number, z: number, yaw: number, speed = 0): Car {
  const c = createCar(x, z, yaw, s, "player");
  toggleFlight(c, s);
  c.lift = 0;
  c.vy = 0;
  c.y = y;
  c.flyT = 1;
  c.vf = speed;
  return c;
}

/** Runs the car for `seconds`: in the air, and on the ground once it lands. */
function fly(c: Car, a: Actions, s: Solids, seconds: number, each = () => {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    carStep(c, a, DT, s);
    each();
  }
}

describe("flyStep", () => {
  it("steering right turns right and banks the right side down, no deeper than the limit", () => {
    const { solids } = canalWorld();
    // Nose to -z: its right is +x.
    const c = flying(solids, 40, 10, 80, Math.PI, 10);
    const a = makeActions();
    a.steer = 1;
    a.throttle = 0.3;
    let deepest = 0;
    fly(c, a, solids, 1, () => {
      expect(c.roll).toBeGreaterThanOrEqual(0);
      deepest = Math.max(deepest, Math.abs(c.roll));
    });
    expect(c.x).toBeGreaterThan(40.5);
    expect(c.roll).toBeGreaterThan(0.05);
    // Harder and longer still keeps within the bank's limit.
    a.throttle = 1;
    fly(c, a, solids, 4, () => (deepest = Math.max(deepest, Math.abs(c.roll))));
    expect(deepest).toBeLessThanOrEqual(MAX_ROLL);
  });

  it("climbs to the ceiling over the tallest house and no higher", () => {
    const { solids } = canalWorld([TOWER]);
    const c = flying(solids, 60, 5, 60, EAST);
    const a = makeActions();
    a.up = true;
    let top = 0;
    fly(c, a, solids, 60, () => (top = Math.max(top, c.y)));
    expect(c.y).toBeCloseTo(solids.tallest + CAR.ceilingAbove);
    expect(top).toBeLessThanOrEqual(40 + CAR.ceilingAbove);
    // Held there it does not keep climbing: let go and descend, and it comes down at once.
    expect(c.vy).toBeLessThanOrEqual(0);
    a.up = false;
    a.down = true;
    fly(c, a, solids, 0.3);
    expect(c.y).toBeLessThan(solids.tallest + CAR.ceilingAbove - 0.3);
  });

  it("climbing under a bridge deck stops under it, not through it", () => {
    const { solids } = bridgeWorld();
    const deck = deckLift(0);
    const c = flying(solids, 170, HOVER, 50, EAST);
    const a = makeActions();
    a.up = true;
    fly(c, a, solids, 5, () => expect(c.y).toBeLessThanOrEqual(deck - HEADROOM + 1e-9));
    expect(c.y).toBeCloseTo(deck - HEADROOM);
    expect(c.vy).toBe(0);
  });

  it("touches down and flies onto a low roof without a jump", () => {
    const { solids } = canalWorld([{ x: 40, z: 40, w: 20, d: 20, h: 1.5 }]);
    const c = flying(solids, 20, 10, 50, EAST);
    toggleFlight(c, solids);
    let prev = c.y;
    let most = 0;
    const each = (car: Car) => () => {
      most = Math.max(most, Math.abs(car.y - prev));
      prev = car.y;
    };
    fly(c, makeActions(), solids, 10, each(c));
    expect(c.flying).toBe(false);
    expect(c.y).toBe(0);
    expect(most).toBeLessThanOrEqual(0.15);
    // Hovering at 1 m, sideways over a 1.5 m roof: the hover height rises 1.5 m under it.
    const low = flying(solids, 34, HOVER, 50, EAST, 8);
    prev = low.y;
    most = 0;
    fly(low, makeActions(), solids, 3, each(low));
    expect(low.x).toBeGreaterThan(42);
    expect(low.y).toBeCloseTo(1.5 + HOVER);
    expect(most).toBeLessThanOrEqual(0.15);
  });

  it("landing as it crosses onto a low roof climbs onto it, not up in a step", () => {
    const { solids } = canalWorld([{ x: 40, z: 40, w: 20, d: 20, h: 0.55 }]);
    const c = flying(solids, 37, 0.4, 50, EAST, 6);
    toggleFlight(c, solids); // landing: coming down while it drifts over the roof's edge
    let prev = c.y;
    let most = 0;
    fly(c, makeActions(), solids, 4, () => {
      most = Math.max(most, Math.abs(c.y - prev));
      prev = c.y;
    });
    expect(c.flying).toBe(false);
    expect(c.y).toBeCloseTo(0.55);
    expect(most).toBeLessThanOrEqual(0.15);
  });

  it("hovering at 1 m flies onto a roof exactly the climb limit higher", () => {
    const { solids } = canalWorld([{ x: 40, z: 40, w: 20, d: 20, h: HOVER + 0.6 }]);
    const c = flying(solids, 34, HOVER, 50, EAST, 8);
    fly(c, makeActions(), solids, 3);
    expect(c.x).toBeGreaterThan(42); // over it, not stopped at its edge as at a wall
  });

  it("off the throttle it slows down from 20 m/s and hovers with a light bob", () => {
    const { solids } = canalWorld();
    const c = flying(solids, 10, 10, 50, EAST, 20);
    fly(c, makeActions(), solids, 10);
    expect(Math.hypot(c.vx, c.vz)).toBeLessThan(1);
    const rest = c.y;
    let lo = Infinity;
    let hi = -Infinity;
    fly(c, makeActions(), solids, 10, () => {
      const shown = c.y + hoverBob(c);
      lo = Math.min(lo, shown);
      hi = Math.max(hi, shown);
    });
    expect(Math.max(hi - rest, rest - lo)).toBeLessThanOrEqual(0.3);
    expect(hi - lo).toBeGreaterThan(0.05);
  });

  it("lands on a roof and drives there", () => {
    const { solids } = canalWorld([TOWER]);
    const c = flying(solids, 30, 48, 30, EAST);
    toggleFlight(c, solids);
    expect(c.landing).toBe(true);
    fly(c, makeActions(), solids, 10, () => expect(c.y).toBeGreaterThanOrEqual(40));
    expect(c.flying).toBe(false);
    expect(c.y).toBe(solids.roofAt(30, 30));
    driveStep(c, makeActions(), DT, solids);
    expect(c.y).toBe(40);
  });

  it("takes off from the ground by itself, without a jump", () => {
    const { solids } = canalWorld();
    const c = createCar(20, 20, EAST, solids, "player");
    toggleFlight(c, solids);
    let prev = c.y;
    fly(c, makeActions(), solids, 2, () => {
      expect(c.y - prev).toBeLessThan(0.3);
      prev = c.y;
    });
    expect(c.flying).toBe(true);
    expect(c.y).toBeGreaterThanOrEqual(HOVER);
  });

  it("does not land on water: it keeps hovering over it and says so", () => {
    const { solids } = canalWorld();
    const c = flying(solids, 100, 10, 20, EAST);
    const a = makeActions();
    a.down = true;
    fly(c, a, solids, 5);
    expect(c.y).toBeCloseTo(HOVER);
    toggleFlight(c, solids);
    expect(c.cantLand).toBe(true);
    expect(c.landing).toBe(false);
    fly(c, makeActions(), solids, 3);
    expect(c.flying).toBe(true);
    expect(c.y).toBeCloseTo(HOVER);
    // The next F, over land, lands.
    c.x = 60;
    toggleFlight(c, solids);
    expect(c.cantLand).toBe(false);
    fly(c, makeActions(), solids, 3);
    expect(c.flying).toBe(false);
  });

  it("a landing that drifts out over the water is called off", () => {
    const { solids } = canalWorld();
    const c = flying(solids, 85, 20, 20, EAST, 15);
    toggleFlight(c, solids);
    expect(c.landing).toBe(true);
    fly(c, makeActions(), solids, 0.6);
    expect(solids.isWater(c.x, c.z)).toBe(true);
    expect(c.flying).toBe(true);
    expect(c.landing).toBe(false);
    expect(c.cantLand).toBe(true);
  });

  it("at the top speed it does not fly through a thin house", () => {
    const { solids } = canalWorld([{ x: 50, z: 0, w: 0.5, d: 100, h: 40 }]);
    const c = flying(solids, 20, 10, 50, EAST, CAR.flyTop);
    const a = makeActions();
    a.throttle = 1;
    fly(c, a, solids, 3);
    expect(c.x).toBeLessThan(50);
  });
});

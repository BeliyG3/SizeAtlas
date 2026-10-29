import { describe, expect, it } from "vitest";
import {
  BOUNCE,
  CAR_CLIMB,
  CAR_DISCS,
  CAR_RADIUS,
  PERSON_DISCS,
  PERSON_RADIUS,
  SLIDE_DRAG,
  CAR_SLOPE,
  HEADROOM,
  collideBodies,
  collideStatic,
  moveBody,
  type Body,
} from "./bodies";
import { deckLift } from "../world/bridgeChains";
import { BRIDGE_RISE } from "../world/map";
import type { Solids } from "./solids";
import { bridgeWorld, canalWorld, type House } from "./world.fixture";

const DT = 1 / 60;
/** The step a person walks up; the walking (task 5) owns its value. */
const STEP = 0.45;
const EAST = Math.PI / 2;

function car(x: number, z: number, yaw = EAST, vx = 0): Body {
  return {
    x,
    y: 0,
    z,
    vx,
    vy: 0,
    vz: 0,
    yaw,
    discs: CAR_DISCS,
    radius: CAR_RADIUS,
    mass: 1200,
    flying: false,
  };
}

function person(x: number, z: number): Body {
  return {
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    discs: PERSON_DISCS,
    radius: PERSON_RADIUS,
    mass: 80,
    flying: false,
  };
}

/** The centres of the body's discs. */
function centres(b: Body): [number, number][] {
  return b.discs.map((off) => [b.x + Math.sin(b.yaw) * off, b.z + Math.cos(b.yaw) * off]);
}

/** Runs `steps` steps of `b` against `solids`; `each` sees every step. Returns the hardest hit. */
function run(b: Body, solids: Solids, steps: number, each = () => {}, slope = slopeOf(b)): number {
  const climb = b.discs === CAR_DISCS ? CAR_CLIMB : STEP;
  let hit = 0;
  for (let i = 0; i < steps; i++) {
    hit = Math.max(hit, moveBody(b, DT, solids, climb, slope));
    each();
  }
  return hit;
}

function slopeOf(b: Body): number {
  return b.discs === CAR_DISCS ? CAR_SLOPE : 0;
}

/** Runs a car on the ground: its height follows what it stands on. */
function drive(c: Body, solids: Solids, steps: number, each = () => {}, slope = slopeOf(c)) {
  run(
    c,
    solids,
    steps,
    () => {
      c.y = solids.heightAt(c.x, c.z, c.y + CAR_CLIMB);
      each();
    },
    slope,
  );
}

describe("collideStatic", () => {
  const wall = (w: number): House => ({ x: 30, z: 0, w, d: 40, h: 20 });

  it("a car hitting a wall stops short of it and bounces back a little", () => {
    const { solids } = canalWorld([wall(10)]);
    // The front disc's rim 2 m short of the wall.
    const c = car(30 - 2 - 1.4 - CAR_RADIUS, 20, EAST, 30);
    let before = 0;
    let after = 0;
    const hit = run(c, solids, 60, () => {
      for (const [x, z] of centres(c)) expect(solids.roofAt(x, z)).toBeNull();
      if (c.vx > 0) before = c.vx;
      else after = after || -c.vx;
    });
    expect(before).toBe(30);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(BOUNCE * before + 1e-9);
    expect(hit).toBeCloseTo(30, 0);
  });

  it.each([1, 0.2])("a car at 38 m/s does not pass through a house %f m thick", (w) => {
    const { solids } = canalWorld([wall(w)]);
    const c = car(20, 20, EAST, 38);
    run(c, solids, 60, () => {
      for (const [x, z] of centres(c)) {
        expect(solids.roofAt(x, z)).toBeNull();
        expect(x).toBeLessThan(30);
      }
    });
  });

  it("a person thrown at 38 m/s does not pass through a house 0.2 m thick", () => {
    const { solids } = canalWorld([wall(0.2)]);
    const p = person(25, 20);
    p.vx = 38;
    run(p, solids, 60, () => expect(p.x).toBeLessThan(30));
  });

  it("a person walking into a wall slides along it", () => {
    const { solids } = canalWorld([wall(10)]);
    const p = person(30 - PERSON_RADIUS - 0.01, 10);
    const speed = 2;
    run(p, solids, 30, () => {
      expect(solids.roofAt(p.x, p.z)).toBeNull();
      // The walking sets the speed again every step.
      p.vx = speed;
      p.vz = speed;
    });
    expect(p.z - 10).toBeGreaterThanOrEqual(0.8 * speed * 30 * DT);
  });

  it("a person walks up a step, not up a wall", () => {
    const { solids } = canalWorld([
      { x: 30, z: 0, w: 10, d: 20, h: 0.4 },
      { x: 30, z: 20, w: 10, d: 20, h: 0.6 },
    ]);
    const low = person(29, 10);
    const high = person(29, 30);
    for (const p of [low, high]) {
      p.vx = 1.4;
      run(p, solids, 60);
    }
    expect(low.x).toBeGreaterThan(30);
    expect(high.x).toBeLessThan(30);
  });

  it("a car on the ground stops at the water; a flying one crosses it", () => {
    // The canal runs at x 90…110.
    const { solids } = canalWorld();
    const ground = car(80, 80, EAST, 15);
    const flying = { ...car(80, 80, EAST, 15), y: 5, flying: true };
    run(ground, solids, 180, () => {
      for (const [x, z] of centres(ground)) expect(solids.isWater(x, z)).toBe(false);
    });
    run(flying, solids, 180);
    expect(ground.x).toBeLessThan(90);
    expect(flying.x).toBeGreaterThan(110);
  });

  it("a car drives onto the canal bridge", () => {
    const { solids } = canalWorld();
    const c = car(70, 50, EAST, 10);
    drive(c, solids, 120);
    expect(c.x).toBeGreaterThan(85);
    expect(c.y).toBeCloseTo(BRIDGE_RISE);
  });

  it("a car at 10 m/s drives up an island bridge and across to the other island", () => {
    const { solids } = bridgeWorld();
    const c = car(70, 50, EAST, 10);
    let top = 0;
    drive(c, solids, 20 * 60, () => {
      expect(solids.isWater(c.x, c.z, c.y + HEADROOM)).toBe(false);
      top = Math.max(top, c.y);
    });
    expect(c.x).toBeGreaterThan(260);
    expect(top).toBeCloseTo(deckLift(0));
    expect(c.vx).toBeCloseTo(10);
  });

  it("a car follows a ramp steeper than its climb over its length; a kerb as high stops it", () => {
    // 1 m to 8 m over 17.5 m: 0.4 m a metre, 1 m from the middle of the car to its nose.
    const { solids } = bridgeWorld(17.5);
    const up = car(70, 50, EAST, 10);
    drive(up, solids, 6 * 60);
    expect(up.x).toBeGreaterThan(125);
    const stuck = car(70, 50, EAST, 10);
    drive(stuck, solids, 6 * 60, () => {}, 0);
    expect(stuck.x).toBeLessThan(110);
    // A step of 1 m (a house that low) is no ramp.
    const kerb = canalWorld([{ x: 30, z: 0, w: 10, d: 40, h: 1 }]);
    const c = car(20, 20, EAST, 10);
    drive(c, kerb.solids, 120);
    expect(c.x).toBeLessThan(30 - 1.4);
  });

  it.each([
    [0.45, true],
    [0.55, false],
  ])("a ramp of %f m a metre: the car drives up it, %s", (slope, climbs) => {
    // From the gate at 1 m to the deck at 8 m.
    const { solids } = bridgeWorld(7 / slope);
    const c = car(70, 50, EAST, 10);
    drive(c, solids, 6 * 60);
    expect(c.y > 7).toBe(climbs);
    expect(CAR_SLOPE).toBe(0.5);
  });

  it("a body inside a house backs out the way it came", () => {
    const { solids } = canalWorld([wall(10)]);
    const p = person(35, 20);
    p.vx = 1;
    expect(collideStatic(p, solids, STEP, DT)).toBeCloseTo(1);
    expect(p.x).toBeLessThan(35);
    expect(p.vx).toBeLessThan(0);
  });

  it("the drag along a wall is the same at any speed", () => {
    const { solids } = canalWorld([wall(10)]);
    const kept = [1, 40].map((speed) => {
      const p = person(30 - PERSON_RADIUS + 0.01, 10);
      p.vx = 0.5;
      p.vz = speed;
      moveBody(p, DT, solids, STEP);
      return p.vz / speed;
    });
    expect(kept[0]).toBeCloseTo(Math.exp(-SLIDE_DRAG * DT));
    expect(kept[1]).toBeCloseTo(kept[0]);
  });
});

describe("collideBodies", () => {
  it("two cars head on at 10 m/s bounce apart at 3 m/s", () => {
    // Their front discs 2.3 m apart: 0.1 m into each other.
    const a = car(0, 0, EAST, 10);
    const b = car(1.4 + 2.3 + 1.4, 0, -EAST, -10);
    const hit = collideBodies(a, b);
    expect(hit).toBeCloseTo(20);
    expect(a.vx).toBeCloseTo(-3);
    expect(b.vx).toBeCloseTo(3);
    expect(b.x - a.x).toBeCloseTo(1.4 + 2 * CAR_RADIUS + 1.4);
  });

  it("an infinitely heavy body does not move", () => {
    const a = car(0, 0, EAST, 10);
    const wall = { ...car(5, 0, -EAST), mass: Infinity };
    expect(collideBodies(a, wall)).toBeCloseTo(10);
    expect(wall.x).toBe(5);
    expect(wall.vx).toBe(0);
    expect(a.vx).toBeCloseTo(-3);
  });

  it("bodies apart, or one over the other, do not touch", () => {
    expect(collideBodies(car(0, 0, EAST, 10), car(10, 0, -EAST, -10))).toBe(0);
    expect(collideBodies(car(0, 0, EAST, 10), { ...car(4, 0, -EAST, -10), y: 8 })).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { createResidents, type Residents } from "../actors/residents";
import type { Traffic } from "../actors/traffic";
import { canalWorld } from "../physics/world.fixture";
import { CLIP, doorOf } from "./boarding";
import { makeActions, type Actions } from "./input";
import { createPlayer, pressPlayer, stepPlayer, type Player, type PlayWorld } from "./player";
import { createCar } from "./vehicle";

const DT = 1 / 60;
const EAST = Math.PI / 2;
/** A 40 m house at x 20…40, z 20…40. */
const TOWER = { x: 20, z: 20, w: 20, d: 20, h: 40 };

/** One ground car of the traffic at (x, z), heading +z. */
const oneCar = (x: number, z: number): Traffic => ({
  count: 1,
  x: Float32Array.of(x),
  y: Float32Array.of(0),
  z: Float32Array.of(z),
  heading: Float32Array.of(0),
  air: Uint8Array.of(0),
  appear: Float32Array.of(1),
  live: Uint8Array.of(1),
  update: () => {},
});

function press(p: Player, w: PlayWorld, o: Partial<Actions>) {
  pressPlayer(p, Object.assign(makeActions(), o), w);
}

/** Steps the player for `seconds` with `a` held. */
function run(p: Player, w: PlayWorld, seconds: number, a = makeActions()) {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepPlayer(p, a, DT, w);
}

/** Steps until the player is `state`, at most `seconds`; the seconds it took. */
function until(p: Player, w: PlayWorld, state: Player["state"], seconds = 30): number {
  let i = 0;
  for (; p.state !== state && i < seconds * 60; i++) stepPlayer(p, makeActions(), DT, w);
  return i * DT;
}

/** The player `away` metres east of the driver's door of a car at (x, z) nose to +z. */
function byDoor(x: number, z: number, away: number, w: PlayWorld): Player {
  const door = doorOf(x, z, 0, { x: 0, z: 0 });
  return createPlayer({ x: door.x + away, z: door.z, yaw: -EAST }, w.solids);
}

const near = (r: Residents, x: number, z: number, d: number) =>
  Array.from(r.x).filter((rx, i) => Math.hypot(rx - x, r.z[i] - z) <= d).length;

describe("getting in", () => {
  it("into an empty car from 2.5 m: Enter_Car, then driving once it is over", () => {
    const { solids } = canalWorld();
    const car = createCar(40, 70, 0, solids, "empty");
    const w: PlayWorld = { solids, cars: [car], traffic: null, residents: null };
    const p = byDoor(40, 70, 2.5, w);
    press(p, w, { use: true });
    expect(p.state).toBe("enter");
    expect(p.car).toBe(car);
    expect(car.owner).toBe("player");
    const len = p.script!.length;
    // The clip, and the steps to the door before it.
    expect(len).toBeGreaterThan(CLIP.enter.length + 2 / 1.25);
    run(p, w, len - 0.1);
    expect(p.state).toBe("enter");
    run(p, w, 0.2);
    expect(p.state).toBe("drive");
  });

  it("not from 3.5 m", () => {
    const { solids } = canalWorld();
    const car = createCar(40, 70, 0, solids, "empty");
    const w: PlayWorld = { solids, cars: [car], traffic: null, residents: null };
    const p = byDoor(40, 70, 3.5, w);
    press(p, w, { use: true });
    expect(p.state).toBe("walk");
    expect(car.owner).toBe("empty");
  });

  it("into a traffic car: it leaves the traffic, its driver gets out and walks off as a resident", () => {
    const { solids, roads } = canalWorld();
    const traffic = oneCar(40, 30);
    const residents = createResidents(roads, 20, 1);
    const w: PlayWorld = { solids, cars: [], traffic, residents };
    const door = doorOf(40, 30, 0, { x: 0, z: 0 });
    const p = byDoor(40, 30, 2, w);
    const before = near(residents, door.x, door.z, 3);
    press(p, w, { use: true });
    expect(p.state).toBe("enter");
    expect(traffic.live[0]).toBe(0);
    expect(w.cars).toHaveLength(1);
    const car = w.cars[0];
    expect([car.x, car.z, car.yaw, car.owner]).toEqual([40, 30, 0, "player"]);
    // The driver first: Exit_Car, then the door shuts.
    run(p, w, CLIP.exit.length);
    expect(p.driver).not.toBeNull();
    run(p, w, 2);
    expect(p.driver).toBeNull();
    expect(near(residents, door.x, door.z, 3)).toBe(before + 1);
    until(p, w, "drive");
    expect(p.state).toBe("drive");
    expect(traffic.live[0]).toBe(0);
  });

  it("does not reach a car on a roof from the street below", () => {
    const { solids } = canalWorld([TOWER]);
    const roof = createCar(38, 30, 0, solids, "empty");
    expect(roof.y).toBe(40);
    const w: PlayWorld = { solids, cars: [roof], traffic: null, residents: null };
    const door = doorOf(38, 30, 0, { x: 0, z: 0 });
    const p = createPlayer({ x: door.x + 1, z: door.z, yaw: 0 }, solids);
    expect(p.walker.body.y).toBe(0);
    press(p, w, { use: true });
    expect(p.state).toBe("walk");
  });
});

/** The player at the wheel of a car at (x, z) nose to +z (put there: its door may be in a wall). */
function driving(w: PlayWorld, x: number, z: number): Player {
  const car = createCar(x, z, 0, w.solids, "player");
  w.cars.push(car);
  const p = createPlayer({ x, z, yaw: 0 }, w.solids);
  p.car = car;
  p.state = "drive";
  return p;
}

describe("getting out", () => {
  it("by a wall on the door's side: out the other side, never into the house", () => {
    // A house just past the car's left (+x).
    const { solids } = canalWorld([{ x: 61.5, z: 50, w: 10, d: 20, h: 6 }]);
    const w: PlayWorld = { solids, cars: [], traffic: null, residents: null };
    const p = driving(w, 60, 60);
    const car = p.car!;
    press(p, w, { use: true });
    expect(p.state).toBe("exit");
    expect(p.mirror).toBe(true);
    until(p, w, "walk");
    const b = p.walker.body;
    expect(solids.roofAt(b.x, b.z)).toBeNull();
    expect(b.y).toBe(0);
    expect(b.x).toBeLessThan(60);
    expect(car.owner).toBe("empty");
    expect(p.car).toBeNull();
  });

  it("between two walls: out over the back; boxed in on the back too, stays in", () => {
    const walls = [
      { x: 61.5, z: 50, w: 10, d: 20, h: 6 },
      { x: 48.5, z: 50, w: 10, d: 20, h: 6 },
    ];
    const { solids } = canalWorld(walls);
    const w: PlayWorld = { solids, cars: [], traffic: null, residents: null };
    // Its back is clear: the gap between the walls.
    const p = driving(w, 60, 68);
    press(p, w, { use: true });
    expect(p.state).toBe("exit");
    until(p, w, "walk");
    expect(solids.roofAt(p.walker.body.x, p.walker.body.z)).toBeNull();
    expect(p.walker.body.z).toBeLessThan(66);

    const shut = canalWorld([...walls, { x: 55, z: 55, w: 10, d: 10, h: 6 }]);
    const w2: PlayWorld = { solids: shut.solids, cars: [], traffic: null, residents: null };
    const q = driving(w2, 60, 68);
    press(q, w2, { use: true });
    expect(q.state).toBe("drive");
  });
});

describe("driving and flying", () => {
  it("F takes off, F over a roof lands on it, E gets out onto it and its edge holds", () => {
    const { solids } = canalWorld([TOWER]);
    const w: PlayWorld = { solids, cars: [], traffic: null, residents: null };
    const p = driving(w, 60, 70);
    const car = p.car!;
    press(p, w, { fly: true });
    run(p, w, 0.1);
    expect(p.state).toBe("fly");
    // Over the roof's middle.
    Object.assign(car, { x: 30, z: 30, y: 44, vy: 0, lift: 0 });
    press(p, w, { fly: true });
    until(p, w, "drive", 10);
    expect(p.state).toBe("drive");
    expect(car.y).toBe(40);
    press(p, w, { use: true });
    expect(p.state).toBe("exit");
    until(p, w, "walk");
    const walker = p.walker;
    expect(walker.body.y).toBe(40);
    expect(walker.roof).toBe(true);
    // Toward the roof's east edge at x = 40, for long enough to pass it.
    p.look = EAST;
    run(p, w, 5, Object.assign(makeActions(), { move: { x: 0, y: 1 } }));
    expect(walker.body.x).toBeLessThan(40);
    expect(walker.body.x).toBeGreaterThan(38);
    expect(walker.body.y).toBe(40);
  });
});

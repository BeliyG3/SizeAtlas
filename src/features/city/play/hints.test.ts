import { describe, expect, it } from "vitest";
import { canalWorld } from "../physics/world.fixture";
import { doorOf } from "./boarding";
import { hintKeys, makeHud, readHud, sameHud, type HudState } from "./hints";
import { makeActions } from "./input";
import { createPlayer, pressPlayer, stepPlayer, type PlayWorld } from "./player";
import { createCar } from "./vehicle";

const DT = 1 / 60;
const hud = (o: Partial<HudState>): HudState => ({ ...makeHud(), ...o });

describe("hintKeys", () => {
  it.each([
    ["on foot, nothing near", hud({}), []],
    ["at a door", hud({ near: true }), ["play.hint.enter"]],
    [
      "in a car, still",
      hud({ state: "drive", canExit: true }),
      ["play.hint.exit", "play.hint.takeOff"],
    ],
    ["in a car, moving", hud({ state: "drive" }), ["play.hint.takeOff"]],
    ["flying", hud({ state: "fly", flying: true }), ["play.hint.land"]],
    [
      "flying over water",
      hud({ state: "fly", flying: true, cantLand: true }),
      ["play.hint.noLanding"],
    ],
    ["getting in", hud({ state: "enter", near: true }), []],
    [
      "paused, whatever else",
      hud({ state: "drive", canExit: true, paused: true }),
      ["play.paused"],
    ],
  ])("%s", (_, h, keys) => expect(hintKeys(h)).toEqual(keys));
});

describe("readHud", () => {
  it("follows the player from the door into the car, still, and up", () => {
    const { solids } = canalWorld();
    const car = createCar(40, 70, 0, solids, "empty");
    const w: PlayWorld = { solids, cars: [car], traffic: null, residents: null };
    const door = doorOf(40, 70, 0, { x: 0, z: 0 });
    const far = createPlayer({ x: door.x + 20, z: door.z, yaw: 0 }, solids);
    const p = createPlayer({ x: door.x + 2.5, z: door.z, yaw: 0 }, solids);
    const out = makeHud();

    expect(readHud(far, w, out).near).toBe(false);
    expect(readHud(p, w, out).near).toBe(true);
    pressPlayer(p, Object.assign(makeActions(), { use: true }), w);
    expect(readHud(p, w, out)).toMatchObject({ state: "enter", near: false, canExit: false });
    for (let i = 0; i < 60 * 10 && p.state !== "drive"; i++) stepPlayer(p, makeActions(), DT, w);
    expect(readHud(p, w, out)).toMatchObject({ state: "drive", canExit: true, flying: false });

    car.vf = 10;
    expect(readHud(p, w, out).canExit).toBe(false);
    car.vf = 0;

    pressPlayer(p, Object.assign(makeActions(), { fly: true }), w);
    stepPlayer(p, makeActions(), DT, w);
    expect(readHud(p, w, out)).toMatchObject({ state: "fly", flying: true, canExit: false });
    car.cantLand = true;
    expect(readHud(p, w, out).cantLand).toBe(true);
  });

  it("sameHud compares every field", () => {
    expect(sameHud(hud({}), hud({}))).toBe(true);
    const changes: Partial<HudState>[] = [
      { state: "fly" },
      { near: true },
      { canExit: true },
      { flying: true },
      { cantLand: true },
      { paused: true },
    ];
    for (const o of changes) expect(sameHud(hud({}), hud(o))).toBe(false);
  });
});

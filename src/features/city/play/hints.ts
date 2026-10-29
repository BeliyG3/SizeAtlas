/**
 * What the HUD says: a small snapshot of the player read from the game each frame, and the hints
 * it calls for. Pure, no three.js or React; the HUD is told only when the snapshot changes.
 */
import { exitSpot, nearestDoor, type Spot } from "./boarding";
import { isStill, type Player, type PlayerState, type PlayWorld } from "./player";

export interface HudState {
  state: PlayerState;
  /** On foot with a driver's door within reach (E gets in). */
  near: boolean;
  /** In a car standing still with room to get out (E gets out). */
  canExit: boolean;
  flying: boolean;
  /** The last landing was refused: water under the car. */
  cantLand: boolean;
  paused: boolean;
}

export const makeHud = (): HudState => ({
  state: "walk",
  near: false,
  canExit: false,
  flying: false,
  cantLand: false,
  paused: false,
});

const scratch: Spot = { x: 0, z: 0 };

/** Reads the player into `out` (`paused` is the game's, left as it is). */
export function readHud(p: Player, w: PlayWorld, out: HudState): HudState {
  const car = p.car;
  const b = p.walker.body;
  out.state = p.state;
  out.near =
    p.state === "walk" &&
    p.walker.grounded &&
    nearestDoor(b.x, b.y, b.z, w.cars, w.traffic, w.solids) !== null;
  out.canExit =
    !!car && p.state === "drive" && isStill(car) && exitSpot(car, w.solids, scratch) !== null;
  out.flying = p.state === "fly";
  out.cantLand = !!car && car.flying && car.cantLand;
  return out;
}

export function sameHud(a: HudState, b: HudState): boolean {
  return (
    a.state === b.state &&
    a.near === b.near &&
    a.canExit === b.canExit &&
    a.flying === b.flying &&
    a.cantLand === b.cantLand &&
    a.paused === b.paused
  );
}

/** The i18n keys of the hints to show, in order. */
export function hintKeys(h: HudState): string[] {
  if (h.paused) return ["play.paused"];
  if (h.state === "walk") return h.near ? ["play.hint.enter"] : [];
  if (h.state === "drive") {
    return h.canExit ? ["play.hint.exit", "play.hint.takeOff"] : ["play.hint.takeOff"];
  }
  if (h.state === "fly") return [h.cantLand ? "play.hint.noLanding" : "play.hint.land"];
  return [];
}

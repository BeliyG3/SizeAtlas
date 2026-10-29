import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Hud } from "./Hud";
import { makeHud, type HudState } from "./hints";

vi.mock("../../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

type Node = ReactElement<{ children: Node[] | string }>;

/** The text of every hint in the HUD, in order. */
function shown(h: Partial<HudState>): string[] {
  const tree = Hud({ hud: { ...makeHud(), ...h } }) as Node;
  const hints = (tree.props.children as Node[])[1];
  return (hints.props.children as Node[]).map((span) => span.props.children as string);
}

describe("Hud", () => {
  it("at a door: get in", () => {
    expect(shown({ near: true })).toEqual(["play.hint.enter"]);
  });

  it("in a car, still, on the ground: get out and take off", () => {
    expect(shown({ state: "drive", canExit: true })).toEqual([
      "play.hint.exit",
      "play.hint.takeOff",
    ]);
  });

  it("flying: land, or why it cannot", () => {
    expect(shown({ state: "fly", flying: true })).toEqual(["play.hint.land"]);
    expect(shown({ state: "fly", flying: true, cantLand: true })).toEqual(["play.hint.noLanding"]);
  });

  it("paused: only that", () => {
    expect(shown({ state: "drive", canExit: true, paused: true })).toEqual(["play.paused"]);
  });

  it("on foot with nothing near: no hint", () => {
    expect(shown({})).toEqual([]);
  });
});

import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import { ROAD } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { carsFor, createLife, GAME_LIMITS, peopleFor } from "./life";

// No models in a test: the life is there without them.
vi.mock("../render/assets", () => ({ loadAssets: () => new Promise(() => {}) }));

describe("life on an archipelago", () => {
  it("has 100 cars an island, up to 400", () => {
    expect([1, 3, 8, 0].map(carsFor)).toEqual([100, 300, 400, 100]);
  });

  it("has 150 residents an island, up to 525", () => {
    expect([1, 3, 4, 8].map(peopleFor)).toEqual([150, 450, 525, 525]);
  });

  it("in the game, up to 150 cars and 400 residents", () => {
    // 3 km of highway and street: room for 300 cars.
    const g = buildRoads(
      mapOf([], {
        nodes: new Float32Array([0, 0, 1500, 0, 3000, 0]),
        edges: [
          { a: 0, b: 1, cls: ROAD.highway, bridge: false, liftA: 0, liftB: 0 },
          { a: 1, b: 2, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 },
        ],
      }),
    );
    const life = createLife(new Group(), () => {}, GAME_LIMITS);
    life.populate(g, 1, 8);
    expect(life.actors()?.traffic.count).toBe(150);
    expect(life.actors()?.residents.count).toBe(400);
    life.dispose();
  });
});

import { Vector3, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { createLife } from "./life";

// Models that draw nothing: the panel's step moves its people as with the real ones.
const { model } = vi.hoisted(() => ({
  model: () => ({
    group: { visible: true },
    mesh: { visible: true },
    points: { visible: true },
    tail: { x: 0, y: 0, z: 0 },
    update() {},
    dispose() {},
  }),
}));
vi.mock("../render/assets", () => ({
  loadAssets: () => Promise.resolve({ car: null, walker: null }),
}));
vi.mock("../render/cars", () => ({ carInstances: model }));
vi.mock("../render/people", () => ({ peopleInstances: model }));
vi.mock("../render/trails", () => ({ trailMesh: model }));
vi.mock("../render/carLights", () => ({ carLights: model, headOf: () => ({ x: 0, y: 0, z: 0 }) }));
vi.mock("../render/crowd", () => ({ crowdMesh: model }));

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

/** FNV-1a over the float bits of the arrays. */
function hashOf(...arrays: Float32Array[]): number {
  let h = 0x811c9dc5;
  for (const a of arrays)
    for (const b of new Uint32Array(Float32Array.from(a).buffer))
      h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

describe("the panel's life", () => {
  it("moves as before the game's obstacles: the same positions after 30 s of steps", async () => {
    // A 400 m square of highway and streets across it.
    const g = graphOf(
      [0, 0, 400, 0, 400, 400, 0, 400, 200, 0, 200, 400],
      [
        [0, 4, ROAD.highway],
        [4, 1, ROAD.highway],
        [1, 2, ROAD.highway],
        [2, 5, ROAD.highway],
        [5, 3, ROAD.highway],
        [3, 0, ROAD.highway],
        [4, 5, ROAD.street],
      ],
    );
    let ready!: () => void;
    const loaded = new Promise<void>((r) => (ready = r));
    const parent = { add() {}, remove() {} } as unknown as Object3D;
    const life = createLife(parent, () => ready());
    life.populate(g, 7, 1);
    await loaded;
    const eye = new Vector3(200, 250, 50);
    const target = new Vector3(200, 0, 200);
    for (let n = 0; n < 30 * 60; n++) life.step(1 / 60, eye, target);
    const { traffic: t, residents: r } = life.actors()!;
    // This test at 036312a, before the traffic saw obstacles.
    expect(hashOf(t.x, t.z, t.heading, r.x, r.z, r.heading)).toBe(3864610151);
    life.dispose();
  });
});

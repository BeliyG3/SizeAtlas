import { describe, expect, it } from "vitest";
import { CAR_DISCS, CAR_RADIUS } from "../physics/bodies";
import { createSolids, type Solids } from "../physics/solids";
import { rect } from "../physics/world.fixture";
import { buildWorld } from "../world/buildings";
import { POLY, ROAD, type MapEdge, type Poly } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { doorOf, REACH } from "./boarding";
import { spawnPoint, type Spawn } from "./spawn";

const street = (a: number, b: number): MapEdge => ({
  a,
  b,
  cls: ROAD.street,
  bridge: false,
  liftA: 0,
  liftB: 0,
});

/**
 * A 400 × 400 m island with streets along z = 100 and z = 300 and between them a block (id 5)
 * built up wall to wall from z 106 to 294, with `extra` polygons; houses are 20 m high.
 */
function town(extra: Poly[] = []) {
  const map = mapOf(
    [
      rect(POLY.island, 1, 0, 0, 400, 400),
      rect(POLY.block, 5, 20, 106, 360, 188),
      rect(POLY.house, 7, 180, 180, 40, 40),
      rect(POLY.house, 8, 20, 106, 160, 188),
      rect(POLY.house, 9, 220, 106, 160, 188),
      rect(POLY.house, 10, 180, 106, 40, 74),
      rect(POLY.house, 11, 180, 220, 40, 74),
      ...extra,
    ],
    {
      width: 400,
      height: 400,
      nodes: new Float32Array([0, 100, 400, 100, 0, 300, 400, 300]),
      edges: [street(0, 1), street(2, 3)],
    },
  );
  const world = buildWorld(map, null);
  for (const b of world.buildings) b.h = 20;
  const g = buildRoads(map);
  const s = createSolids(world, g);
  return { world, g, s };
}

/** The player stands on the bare ground: no house, deck or water under them. */
function standing(s: Solids, p: Spawn) {
  expect(s.heightAt(p.x, p.z)).toBe(0);
  expect(s.isWater(p.x, p.z)).toBe(false);
}

/** The player and their car stand on the bare ground, the car beside the player. */
function onGround(s: Solids, p: Spawn) {
  standing(s, p);
  const car = p.car!;
  expect(car).not.toBeNull();
  for (const d of CAR_DISCS) {
    const x = car.x + Math.sin(car.yaw) * d;
    const z = car.z + Math.cos(car.yaw) * d;
    for (const [ox, oz] of [
      [0, 0],
      [CAR_RADIUS, 0],
      [-CAR_RADIUS, 0],
      [0, CAR_RADIUS],
      [0, -CAR_RADIUS],
    ]) {
      expect(s.heightAt(x + ox, z + oz)).toBe(0);
      expect(s.isWater(x + ox, z + oz)).toBe(false);
    }
  }
  // The car is beside the player, not on them.
  expect(Math.hypot(car.x - p.x, car.z - p.z)).toBeGreaterThan(1.5);
  expect(Math.hypot(car.x - p.x, car.z - p.z)).toBeLessThan(8);
}

describe("spawnPoint", () => {
  it("starts on the sidewalk within 40 m of the selected house", () => {
    const { world, g, s } = town([rect(POLY.house, 12, 50, 110, 10, 10)]);
    const p = spawnPoint(world, g, s, { island: 0, id: 12 });
    expect(Math.hypot(p.x - 55, p.z - 115)).toBeLessThan(40);
    expect(p.z).toBeCloseTo(104, 3); // the sidewalk on the block's side
    onGround(s, p);
  });

  it("goes to the nearest street from a house deep in a built-up block", () => {
    const { world, g, s } = town();
    const p = spawnPoint(world, g, s, { island: 0, id: 7 });
    // The house's middle is (200, 200): both streets are 96 m off its sidewalks.
    expect(Math.abs(p.x - 200)).toBeLessThan(2);
    expect([104, 296].some((z) => Math.abs(p.z - z) < 1e-3)).toBe(true);
    onGround(s, p);
  });

  it("keeps out of a house standing on the sidewalk and out of the water", () => {
    const { world, g, s } = town([
      rect(POLY.house, 12, 50, 110, 10, 10),
      rect(POLY.house, 13, 30, 101, 50, 5), // over the north sidewalk by house 12
      rect(POLY.water, 14, 30, 85, 50, 14), // a pond over the south one
    ]);
    const p = spawnPoint(world, g, s, { island: 0, id: 12 });
    expect(p.x < 30 || p.x > 80).toBe(true);
    expect(Math.hypot(p.x - 55, p.z - 115)).toBeLessThan(40);
    onGround(s, p);
  });

  it("starts by the middle of the first island with nothing selected", () => {
    const { world, g, s } = town();
    const p = spawnPoint(world, g, s, null);
    expect(Math.abs(p.x - 200)).toBeLessThan(2);
    onGround(s, p);
  });

  it("faces along the street, the car's driver's door by the player", () => {
    const { world, g, s } = town();
    const p = spawnPoint(world, g, s, null);
    expect(Math.abs(Math.sin(p.yaw))).toBeCloseTo(1, 6);
    const car = p.car!;
    expect(Math.cos(car.yaw - p.yaw)).toBeCloseTo(-1, 6);
    const door = doorOf(car.x, car.z, car.yaw, { x: 0, z: 0 });
    expect(Math.hypot(door.x - p.x, door.z - p.z)).toBeLessThan(1);
  });

  /** A map of `polys` and `edges`; houses 20 m high. */
  const bare = (polys: Poly[], edges: MapEdge[] = [], nodes: number[] = []) => {
    const map = mapOf(polys, { width: 200, height: 100, nodes: new Float32Array(nodes), edges });
    const world = buildWorld(map, null);
    for (const b of world.buildings) b.h = 20;
    const g = buildRoads(map);
    return { world, g, s: createSolids(world, g) };
  };

  it("on a lane parks the car a little ahead, its driver's door within reach", () => {
    const lane = { ...street(0, 1), cls: ROAD.lane };
    const { world, g, s } = bare([rect(POLY.island, 1, 0, 0, 200, 100)], [lane], [0, 50, 200, 50]);
    const p = spawnPoint(world, g, s, null);
    onGround(s, p);
    const car = p.car!;
    const door = doorOf(car.x, car.z, car.yaw, { x: 0, z: 0 });
    expect(Math.hypot(door.x - p.x, door.z - p.z)).toBeLessThan(REACH);
  });

  it("without streets or lanes starts on another road, carless, out of the house in the middle", () => {
    const highway = { ...street(0, 1), cls: ROAD.highway };
    const { world, g, s } = bare(
      [rect(POLY.island, 1, 0, 0, 200, 100), rect(POLY.house, 2, 80, 30, 40, 40)],
      [highway],
      [0, 80, 200, 80],
    );
    const p = spawnPoint(world, g, s, null);
    standing(s, p);
    expect(p.z).toBeCloseTo(80, 3);
    expect(p.car).toBeNull();
  });

  it("without roads starts on land nearest the middle: not in its house", () => {
    const { world, g, s } = bare([
      rect(POLY.island, 1, 0, 0, 200, 100),
      rect(POLY.house, 2, 80, 30, 40, 40),
    ]);
    const p = spawnPoint(world, g, s, null);
    standing(s, p);
    // The house's nearest wall from its middle (100, 50) is 20 m off.
    expect(Math.hypot(p.x - 100, p.z - 50)).toBeLessThan(23);
  });

  it("without roads starts on land, not in the sea in the middle", () => {
    const { world, g, s } = bare([
      rect(POLY.island, 1, 0, 0, 60, 100),
      rect(POLY.island, 2, 140, 0, 60, 100),
    ]);
    // The first island spans the whole map, sea between its two parts.
    const p = spawnPoint(world, g, s, null);
    standing(s, p);
    expect(p.x < 60 || p.x > 140).toBe(true);
  });
});

/**
 * What the game's bodies stand on and run into, asked point by point: the roofs, the bridge
 * decks, the ground and the water; pure, no three.js. Shapes are binned on a grid of `CELL`
 * metres, so a query looks at a few of them, and it allocates nothing.
 */
import type { World } from "../world/buildings";
import { POLY } from "../world/map";
import type { RoadGraph } from "../world/roads";
import { CELL, binBoxes, cellAt, insidePoly, polyBoxes } from "./bins";
import { createDecks } from "./decks";
import { createRegion, inRegion } from "./region";

export interface Solids {
  /**
   * The surface under a body whose top is at `top` (any height by default): a roof, a bridge
   * deck not over `top` (a higher one passes overhead), else the ground, 0.
   */
  heightAt(x: number, z: number, top?: number): number;
  /**
   * Neither land nor a bridge deck at or under `top` (any height by default): the sea or the
   * canal, also under a deck that passes overhead.
   */
  isWater(x: number, z: number, top?: number): boolean;
  /** The roof of the house standing at (x, z), null if none does. */
  roofAt(x: number, z: number): number | null;
  /** The height of the tallest house, metres. */
  tallest: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export function createSolids(world: World, g: RoadGraph): Solids {
  const { map, buildings } = world;
  const nx = Math.max(1, Math.ceil(map.width / CELL));
  const nz = Math.max(1, Math.ceil(map.height / CELL));
  const ofKind = (kind: number) =>
    createRegion(
      map.polys.filter((p) => p.kind === kind).map((p) => p.points),
      nx,
      nz,
    );
  const land = ofKind(POLY.island);
  const canal = ofKind(POLY.water);
  const deckUnder = createDecks(g, nx, nz);

  // Houses are small: a cell lists them whole, and a point is tested against each polygon.
  const houses = buildings.map((b) => b.points);
  const boxes = polyBoxes(houses);
  const bins = binBoxes(boxes, nx, nz);
  const roofs = Float64Array.from(buildings, (b) => b.h);
  const roofTop = (x: number, z: number): number => {
    const cell = cellAt(bins, x, z);
    let best = -Infinity;
    if (cell < 0) return best;
    for (let k = bins.start[cell]; k < bins.start[cell + 1]; k++) {
      const i = bins.items[k];
      const b = i * 4;
      const inBox = x >= boxes[b] && x <= boxes[b + 2] && z >= boxes[b + 1] && z <= boxes[b + 3];
      if (inBox && roofs[i] > best && insidePoly(houses[i], x, z)) best = roofs[i];
    }
    return best;
  };

  return {
    heightAt: (x, z, top = Infinity) => Math.max(0, roofTop(x, z), deckUnder(x, z, top)),
    isWater: (x, z, top = Infinity) =>
      (inRegion(canal, x, z) || !inRegion(land, x, z)) && deckUnder(x, z, top) === -Infinity,
    roofAt: (x, z) => {
      const h = roofTop(x, z);
      return h === -Infinity ? null : h;
    },
    tallest: buildings.reduce((m, b) => Math.max(m, b.h), 0),
    bounds: { minX: 0, minZ: 0, maxX: map.width, maxZ: map.height },
  };
}

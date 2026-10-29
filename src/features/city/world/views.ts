/** The boxes the camera frames: the whole archipelago, one island, one building; pure, no three.js. */
import type { Box } from "../frame";
import type { Building, World } from "./buildings";

/** A view shows this much water around an island, in island sizes. */
export const SHORE_VIEW = 0.1;

/** `box` and a strip of water `SHORE_VIEW` of its size wide around it. */
function withShore({ min, max }: Box): Box {
  const pad = SHORE_VIEW * Math.max(max[0] - min[0], max[2] - min[2]);
  return { min: [min[0] - pad, min[1], min[2] - pad], max: [max[0] + pad, max[1], max[2] + pad] };
}

/** Widens the x, z extent `lo`…`hi` over the points `x0, z0, …`. */
function reach(points: ArrayLike<number>, lo: number[], hi: number[]) {
  for (let i = 0; i < points.length; i += 2) {
    for (let k = 0; k < 2; k++) {
      lo[k] = Math.min(lo[k], points[i + k]);
      hi[k] = Math.max(hi[k], points[i + k]);
    }
  }
}

/** Every island and bridge, with the water around them. */
export function overviewBox(world: World): Box {
  return withShore(world.bounds);
}

/**
 * Island `island` of the world: its map polygons, as high as its tallest house, with the water
 * around it; null if it has no polygon.
 */
export function islandBox(world: World, island: number): Box | null {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const p of world.map.polys) if (p.island === island) reach(p.points, lo, hi);
  if (lo[0] === Infinity) return null;
  const top = world.buildings.reduce((m, b) => (b.island === island ? Math.max(m, b.h) : m), 0);
  return withShore({ min: [lo[0], 0, lo[1]], max: [hi[0], top, hi[1]] });
}

/** The box a building stands in. */
export function buildingBox(b: Building): Box {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  reach(b.points, lo, hi);
  return { min: [lo[0], 0, lo[1]], max: [hi[0], b.h, hi[1]] };
}

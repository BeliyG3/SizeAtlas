/** The scene model of city v2: the island's houses from its map; pure, no three.js. */
import type { Box } from "../frame";
import { POLY, type CityMap, type Poly } from "./map";

export const MIN_H = 6;
export const MAX_H = 160;
/** Filler buildings (the "others" of a block) are low and uneven. */
export const FILLER_MIN = 4;
export const FILLER_MAX = 14;

/**
 * A prism over `points` (`x0, z0, …`, as in the map). `id` and `parent` are the polygon's;
 * `district` is the district's folder id.
 */
export interface Building {
  /** Index of the island the building stands on (folder ids repeat across islands). */
  island: number;
  id: number;
  parent: number;
  district: number;
  kind: "folder" | "filler";
  points: Float32Array;
  h: number;
  size: number;
  dim: boolean;
}

/** A folder on one island: what the view is focused on. */
export interface Focus {
  island: number;
  id: number;
}

export interface World {
  map: CityMap;
  buildings: Building[];
  /** The size of the biggest house: the one that stands `MAX_H` high. */
  tallest: number;
  bounds: Box;
  /** The folder the view is focused on (see `focusIn`), null for none. */
  focus: Focus | null;
  focusBox: Box | null;
}

/** Height of a building of `size` when the biggest one has `max`: grows with √size. */
export function buildingHeight(size: number, max: number): number {
  if (!(max > 0)) return MIN_H;
  const t = Math.min(1, Math.max(0, size / max));
  return MIN_H + (MAX_H - MIN_H) * Math.sqrt(t);
}

/** Deterministic hash of a folder id and a filler's number into [0, 1). */
function hash(id: number, index: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A folder id of one island as one number: ids are u32, so they fit under the island's index. */
function key(island: number, id: number): number {
  return island * 2 ** 32 + id;
}

function isFolder(p: Poly): boolean {
  return p.kind === POLY.district || p.kind === POLY.block || p.kind === POLY.house;
}

/**
 * The houses and fillers of `map`. `focus` is a folder (see `focusIn`) or null: buildings
 * outside it are `dim`, and so are those of the other islands. A building is inside when the
 * focus is its own id, its parent's (the block) or its district's, on the same island.
 */
export function buildWorld(map: CityMap, focus: Focus | null): World {
  // A block's id is its folder's (a district's own id for a filler block); its parent is the district.
  const districtOf = new Map<number, number>();
  for (const p of map.polys) {
    if (p.kind === POLY.block) districtOf.set(key(p.island, p.id), p.parent);
  }
  let tallest = 0;
  for (const p of map.polys) if (p.kind === POLY.house) tallest = Math.max(tallest, p.size);

  const buildings: Building[] = [];
  let fillers = 0;
  for (const p of map.polys) {
    const filler = p.kind === POLY.filler;
    if (p.kind !== POLY.house && !filler) continue;
    const h = filler
      ? FILLER_MIN + (FILLER_MAX - FILLER_MIN) * hash(p.id, fillers++)
      : buildingHeight(p.size, tallest);
    const district = districtOf.get(key(p.island, p.parent)) ?? p.parent;
    buildings.push({
      island: p.island,
      id: p.id,
      parent: p.parent,
      district,
      kind: filler ? "filler" : "folder",
      points: p.points,
      h,
      size: p.size,
      dim:
        focus !== null &&
        (focus.island !== p.island ||
          (focus.id !== p.id && focus.id !== p.parent && focus.id !== district)),
    });
  }

  const top = buildings.reduce((m, b) => Math.max(m, b.h), 0);
  const bounds: Box = { min: [0, 0, 0], max: [map.width, top, map.height] };
  return {
    map,
    buildings,
    tallest,
    bounds,
    focus,
    focusBox: focus === null ? null : boxOf(map, buildings, focus),
  };
}

/** The box around the folder's polygons, as high as its tallest building; null if it has none. */
function boxOf(map: CityMap, buildings: Building[], focus: Focus): Box | null {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const p of map.polys) {
    if (p.island !== focus.island || p.id !== focus.id || !isFolder(p)) continue;
    for (let i = 0; i < p.points.length; i += 2) {
      for (let k = 0; k < 2; k++) {
        lo[k] = Math.min(lo[k], p.points[i + k]);
        hi[k] = Math.max(hi[k], p.points[i + k]);
      }
    }
  }
  if (lo[0] === Infinity) return null;
  const top = buildings.reduce((m, b) => (b.dim ? m : Math.max(m, b.h)), 0);
  return { min: [lo[0], 0, lo[1]], max: [hi[0], top, hi[1]] };
}

/**
 * The deepest folder of `path` (root first) that has a district, block or house polygon on
 * `island`: the one to focus on. Folders the map lost give way to their nearest parent; the root
 * is the whole island, no focus, although its "rest" district carries its id.
 */
export function focusIn(map: CityMap, path: readonly number[], island: number): Focus | null {
  const folders = new Set<number>();
  for (const p of map.polys) if (p.island === island && isFolder(p)) folders.add(p.id);
  for (let i = path.length - 1; i >= 1; i--) {
    if (folders.has(path[i])) return { island, id: path[i] };
  }
  return null;
}

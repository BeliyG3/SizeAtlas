import { api } from "../../api/client";
import type { ArchipelagoIsland } from "../../api/types";
import { mergeIslands } from "./world/archipelago";
import { parseCity, type CityMap } from "./world/map";

/**
 * The reads of islands by `(generation, build)`, finished or on the way: an island that was not
 * rebuilt is not read again, and two requests that overlap read it once.
 */
export type IslandCache = Map<string, Promise<CityMap>>;

/** How often the archipelago is asked for again when an island is rebuilt while it is read. */
const ATTEMPTS = 3;

const keyOf = (island: ArchipelagoIsland) => `${island.generation}:${island.build}`;

/** The cache with only the islands in `islands`. */
export function keepOnly(cache: IslandCache, islands: readonly ArchipelagoIsland[]) {
  const keep = new Set(islands.map(keyOf));
  for (const key of [...cache.keys()]) if (!keep.has(key)) cache.delete(key);
}

/** Are `map`'s bytes the island the archipelago named? */
const fits = (map: CityMap, island: ArchipelagoIsland) =>
  map.generation === island.generation && map.rev === island.rev && map.build === island.build;

function readIsland(island: ArchipelagoIsland, cache: IslandCache): Promise<CityMap> {
  const key = keyOf(island);
  const hit = cache.get(key);
  if (hit) return hit;
  // A response that does not parse fails like a request that does. Neither a failure nor an
  // island of another rev or build than the archipelago named stays: the next request reads it
  // again.
  const read: Promise<CityMap> = api
    .getCity(island.generation)
    .then(parseCity)
    .then(
      (map) => {
        if (!fits(map, island)) cache.delete(key);
        return map;
      },
      (e: unknown) => {
        cache.delete(key);
        throw e;
      },
    );
  cache.set(key, read);
  return read;
}

/**
 * The archipelago around the root `selected` as one map. The offsets and the gates of a bridge fit
 * the bytes of an island only while their `rev` and `build` are the ones the archipelago names: if
 * an island was rebuilt in between (a live scan, or new neighbours that turn its gates), the
 * archipelago is asked again, never merged from both. If it keeps changing, the answer is null
 * (no new picture): the next revision asks again.
 */
export async function readArchipelago(selected: number, cache: IslandCache) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { islands, bridges } = await api.getArchipelago(selected);
    const maps = await Promise.all(islands.map((island) => readIsland(island, cache)));
    if (maps.every((m, i) => fits(m, islands[i]))) {
      const parts = islands.map((island, i) => ({
        generation: island.generation,
        map: maps[i],
        x: island.x,
        z: island.z,
      }));
      return { map: mergeIslands(parts, bridges), islands };
    }
  }
  return null;
}

import { api, isCmdError } from "../../api/client";
import type { ArchipelagoIsland } from "../../api/types";
import { mergeIslands } from "./world/archipelago";
import { parseCity, type CityMap } from "./world/map";

/**
 * The reads of islands by `(generation, build)`, finished or on the way: an island that was not
 * rebuilt is not read again, and two requests that overlap read it once.
 */
export type IslandCache = Map<string, Promise<CityMap>>;

const keyOf = (island: ArchipelagoIsland) => `${island.generation}:${island.build}`;

/** The cache with only the islands in `islands`. */
export function keepOnly(cache: IslandCache, islands: readonly ArchipelagoIsland[]) {
  const keep = new Set(islands.map(keyOf));
  for (const key of [...cache.keys()]) if (!keep.has(key)) cache.delete(key);
}

function readIsland(island: ArchipelagoIsland, cache: IslandCache): Promise<CityMap> {
  const key = keyOf(island);
  const hit = cache.get(key);
  if (hit) return hit;
  // A response that does not parse fails like a request that does; a failure does not stay: the
  // next request reads it again.
  const read: Promise<CityMap> = api
    .getCity(island.generation, island.build)
    .then(parseCity)
    .catch((e: unknown) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, read);
  return read;
}

/** The archipelago around the root `selected` and the bytes of each of its islands. */
async function readOnce(selected: number, cache: IslandCache) {
  const { islands, bridges } = await api.getArchipelago(selected);
  const maps = await Promise.all(islands.map((island) => readIsland(island, cache)));
  return { islands, bridges, maps };
}

/**
 * The archipelago around the root `selected` as one map. Each island is read as the build the
 * archipelago named, so the offsets and the gates of a bridge fit its bytes. Where a newer layout
 * replaced a build before it was read (`BuildGone`: a live scan, or new neighbours that turn its
 * gates), the archipelago is asked once more; a second failure is passed on.
 */
export async function readArchipelago(selected: number, cache: IslandCache) {
  const { islands, bridges, maps } = await readOnce(selected, cache).catch((e: unknown) => {
    if (!isCmdError(e) || e.code !== "BuildGone") throw e;
    return readOnce(selected, cache);
  });
  const parts = islands.map((island, i) => ({
    generation: island.generation,
    map: maps[i],
    x: island.x,
    z: island.z,
  }));
  return { map: mergeIslands(parts, bridges), islands };
}

import { api } from "../../api/client";
import type { ArchipelagoIsland } from "../../api/types";
import { mergeIslands } from "./world/archipelago";
import { parseCity, type CityMap } from "./world/map";

/** Parsed islands by `(generation, rev)`: an island that did not change is not read again. */
export type IslandCache = Map<string, CityMap>;

/** How often the archipelago is asked for again when an island is rebuilt while it is read. */
const ATTEMPTS = 3;

const keyOf = (generation: number, rev: number) => `${generation}:${rev}`;

/** The cache with only the islands in `islands`. */
export function keepOnly(cache: IslandCache, islands: readonly ArchipelagoIsland[]) {
  const keep = new Set(islands.map((i) => keyOf(i.generation, i.rev)));
  for (const key of [...cache.keys()]) if (!keep.has(key)) cache.delete(key);
}

async function readIsland(island: ArchipelagoIsland, cache: IslandCache): Promise<CityMap> {
  const hit = cache.get(keyOf(island.generation, island.rev));
  if (hit) return hit;
  // A response that does not parse fails like a request that does.
  const map = await api.getCity(island.generation).then(parseCity);
  cache.set(keyOf(map.generation, map.rev), map);
  return map;
}

/**
 * The archipelago around the root `selected` as one map. The offsets and the gates of a bridge fit
 * the bytes of an island only while their `rev` is the one the archipelago names: if an island was
 * rebuilt in between (a live scan), the archipelago is asked again, never merged from both.
 */
export async function readArchipelago(selected: number, cache: IslandCache) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { islands, bridges } = await api.getArchipelago(selected);
    const maps = await Promise.all(islands.map((island) => readIsland(island, cache)));
    if (maps.every((m, i) => m.generation === islands[i].generation && m.rev === islands[i].rev)) {
      const parts = islands.map((island, i) => ({
        generation: island.generation,
        map: maps[i],
        x: island.x,
        z: island.z,
      }));
      return { map: mergeIslands(parts, bridges), islands };
    }
  }
  throw new Error("an island kept changing while the archipelago was read");
}

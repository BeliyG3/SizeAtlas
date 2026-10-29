import { useEffect, useMemo, useRef, useState } from "react";
import type { ArchipelagoIsland } from "../../api/types";
import { api } from "../../api/client";
import { beginRefresh, refreshInterval } from "../scan/cadence";
import { keepOnly, readArchipelago, type IslandCache } from "./readArchipelago";
import { buildWorld, focusIn, type World } from "./world/buildings";
import type { CityMap } from "./world/map";

/**
 * Least time between two requests for a new revision, ms: the backend reads the disks and the
 * scan caches on every call, and a dead network share can hold that for seconds. The measured
 * cost of the city can make it longer.
 */
export const REFRESH_MS = 5000;

const NO_ISLANDS: ArchipelagoIsland[] = [];

interface Loaded {
  map: CityMap;
  islands: ArchipelagoIsland[];
  finish: () => void;
}

/**
 * The archipelago around the selected root, lit around the selected folder: one island for each
 * open drive, or the root alone if it is no drive. A new set of roots (or another selected root)
 * is asked for at once; a new `rev` of any root at most once per pause, the latest one when the
 * pause ends. An answer that arrives after a newer request is dropped. What is shown never has
 * an island of a root that is gone: it waits for the next answer. `finish` books the refresh
 * cost once the picture is on screen.
 */
export function useArchipelago(
  roots: readonly { generation: number; rev: number }[],
  selected: { generation: number; id: number },
  onFail: (e: unknown) => void,
): {
  world: World | null;
  islands: ArchipelagoIsland[];
  selectedIsland: number;
  finish: (() => void) | null;
} {
  const generations = roots.map((r) => r.generation).sort((a, b) => a - b);
  const set = `${selected.generation}|${generations.join(",")}`;
  const revs = [...roots]
    .sort((a, b) => a.generation - b.generation)
    .map((r) => `${r.generation}:${r.rev}`)
    .join(",");
  const [asked, setAsked] = useState({ set, revs });
  const askedAt = useRef(0);
  const cache = useRef<IslandCache>(new Map());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [path, setPath] = useState<{ generation: number; ids: number[] } | null>(null);
  // A new set of roots is asked for at once, with the revisions it comes with.
  if (asked.set !== set) setAsked({ set, revs });
  const askedRevs = asked.set === set ? asked.revs : revs;

  useEffect(() => {
    if (revs === askedRevs) return;
    const wait = askedAt.current + Math.max(REFRESH_MS, refreshInterval("city")) - Date.now();
    const timer = setTimeout(() => setAsked({ set, revs }), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [set, revs, askedRevs]);

  useEffect(() => {
    let live = true;
    askedAt.current = Date.now();
    const finish = beginRefresh("city");
    readArchipelago(selected.generation, cache.current).then(
      ({ map, islands }) => {
        if (!live) return;
        keepOnly(cache.current, islands);
        setLoaded({ map, islands, finish });
      },
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [selected.generation, set, askedRevs, onFail]);

  useEffect(() => {
    let live = true;
    api.getCrumbs(selected.generation, selected.id).then(
      (crumbs) =>
        live && setPath({ generation: selected.generation, ids: crumbs.map((c) => c.id) }),
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [selected.generation, selected.id, onFail]);

  // Shown only while every island is of a root still open and the selected root is one of them.
  const selectedIsland =
    loaded?.islands.findIndex((i) => i.generation === selected.generation) ?? -1;
  const shown =
    loaded && selectedIsland >= 0 && loaded.islands.every((i) => generations.includes(i.generation))
      ? loaded
      : null;
  const map = shown?.map ?? null;
  const ids = path?.generation === selected.generation ? path.ids : null;
  const focus = useMemo(
    () => (map && ids ? focusIn(map, ids, selectedIsland) : null),
    [map, ids, selectedIsland],
  );
  const world = useMemo(() => (map ? buildWorld(map, focus) : null), [map, focus]);
  return {
    world,
    islands: shown?.islands ?? NO_ISLANDS,
    selectedIsland: shown ? selectedIsland : -1,
    finish: shown?.finish ?? null,
  };
}

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
 * open drive, or the root alone if it is no drive. A new set of roots is asked for at once, and so
 * is a selected root that is none of the islands shown; moving the selection between the islands
 * asks nothing. A new `rev` of an island (or of the selected root) is asked for at most once per
 * pause, the latest one when the pause ends; the revisions of other roots are none of its
 * business. An answer that arrives after a newer request is dropped: the old picture stays. What
 * is shown never has an island of a root that is gone: it waits for the next answer. `finish`
 * books the refresh cost once the picture is on screen, or once the answer is dropped or failed.
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
  const sorted = [...roots].sort((a, b) => a.generation - b.generation);
  const set = sorted.map((r) => r.generation).join(",");
  const revs = sorted.map((r) => `${r.generation}:${r.rev}`).join(",");
  const [asked, setAsked] = useState({ set, revs, selected: selected.generation });
  const askedAt = useRef(0);
  const cache = useRef<IslandCache>(new Map());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [path, setPath] = useState<{ generation: number; ids: number[] } | null>(null);
  const selectedIsland =
    loaded?.islands.findIndex((i) => i.generation === selected.generation) ?? -1;
  // A new set of roots, or a selected root that no island shown stands for, is asked for at once,
  // with the revisions it comes with. `ask` is what the effects below see in this very render.
  const fresh = { set, revs, selected: selected.generation };
  const stale = asked.set !== set || (selectedIsland < 0 && asked.selected !== selected.generation);
  if (stale) setAsked(fresh);
  const ask = stale ? fresh : asked;

  // The roots whose new revision is worth a request: the islands and the selected root.
  const askedRevs = new Map(
    ask.revs
      .split(",")
      .filter(Boolean)
      .map((r) => r.split(":").map(Number) as [number, number]),
  );
  const watched = new Set([
    selected.generation,
    ...(loaded?.islands ?? []).map((i) => i.generation),
  ]);
  const changed = sorted
    .filter((r) => watched.has(r.generation) && askedRevs.get(r.generation) !== r.rev)
    .map((r) => `${r.generation}:${r.rev}`)
    .join(",");

  useEffect(() => {
    if (!changed) return;
    const wait = askedAt.current + Math.max(REFRESH_MS, refreshInterval("city")) - Date.now();
    const timer = setTimeout(
      () => setAsked({ set, revs, selected: ask.selected }),
      Math.max(0, wait),
    );
    return () => clearTimeout(timer);
  }, [changed, set, revs, ask.selected]);

  useEffect(() => {
    let live = true;
    askedAt.current = Date.now();
    const finish = beginRefresh("city");
    readArchipelago(ask.selected, cache.current).then(
      (read) => {
        if (!live) return finish();
        keepOnly(cache.current, read.islands);
        setLoaded({ map: read.map, islands: read.islands, finish });
      },
      (e: unknown) => {
        finish();
        if (live) onFail(e);
      },
    );
    return () => {
      live = false;
    };
  }, [ask.set, ask.revs, ask.selected, onFail]);

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
  const open = new Set(roots.map((r) => r.generation));
  const shown =
    loaded && selectedIsland >= 0 && loaded.islands.every((i) => open.has(i.generation))
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

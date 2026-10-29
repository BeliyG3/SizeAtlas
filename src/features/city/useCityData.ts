import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { beginRefresh } from "../scan/cadence";
import { buildWorld, focusIn, type World } from "./world/buildings";
import { parseCity, type CityMap } from "./world/map";

/**
 * Least time between two requests of one root, ms: the backend reads the disks and the scan
 * caches on every call, and a dead network share can hold that for seconds.
 */
export const REFRESH_MS = 5000;

/**
 * The island of the root of `generation`, lit around the selection. A new generation is asked
 * for at once and shows nothing until its map comes; a new `rev` at most once per `REFRESH_MS`,
 * the latest one when the pause ends. An answer that arrives after a newer request is dropped.
 * `finish` books the refresh cost once the island is on screen.
 */
export function useCityData(
  generation: number,
  rev: number,
  selectedId: number,
  onFail: (e: unknown) => void,
): { world: World | null; finish: (() => void) | null } {
  const [asked, setAsked] = useState({ generation, rev });
  const askedAt = useRef(0);
  const [loaded, setLoaded] = useState<{ map: CityMap; finish: () => void } | null>(null);
  const [path, setPath] = useState<{ generation: number; ids: number[] } | null>(null);
  // A new root is asked for at once, with the revision it comes with.
  if (asked.generation !== generation) setAsked({ generation, rev });
  const askedRev = asked.generation === generation ? asked.rev : rev;

  useEffect(() => {
    if (rev === askedRev) return;
    const wait = askedAt.current + REFRESH_MS - Date.now();
    const timer = setTimeout(() => setAsked({ generation, rev }), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [generation, rev, askedRev]);

  useEffect(() => {
    let live = true;
    askedAt.current = Date.now();
    const finish = beginRefresh("city");
    // A response that does not parse fails like a request that does.
    api
      .getCity(generation)
      .then(parseCity)
      .then(
        (map) => {
          if (live && map.generation === generation) setLoaded({ map, finish });
        },
        (e: unknown) => live && onFail(e),
      );
    return () => {
      live = false;
    };
  }, [generation, askedRev, onFail]);

  useEffect(() => {
    let live = true;
    api.getCrumbs(generation, selectedId).then(
      (crumbs) => live && setPath({ generation, ids: crumbs.map((c) => c.id) }),
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, selectedId, onFail]);

  const map = loaded?.map.generation === generation ? loaded.map : null;
  const ids = path?.generation === generation ? path.ids : null;
  const focus = useMemo(() => (map && ids ? focusIn(map, ids, 0) : null), [map, ids]);
  const world = useMemo(() => (map ? buildWorld(map, focus) : null), [map, focus]);
  return { world, finish: map ? loaded!.finish : null };
}

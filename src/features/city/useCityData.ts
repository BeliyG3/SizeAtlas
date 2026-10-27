import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { beginRefresh } from "../scan/cadence";
import { parseCity, type CityData } from "./bytes";
import { buildCity, focusIn, type City } from "./model";

/**
 * The city of the root of `generation`, lit around the selection. One request per
 * `{generation, rev}` (the caller throttles `rev` during a live scan); an answer that arrives
 * after a newer request is dropped, and a new generation shows nothing until its city comes.
 * `finish` books the refresh cost once the city is on screen.
 */
export function useCityData(
  generation: number,
  rev: number,
  selectedId: number,
  onFail: (e: unknown) => void,
): { city: City | null; finish: (() => void) | null } {
  const [loaded, setLoaded] = useState<{ data: CityData; finish: () => void } | null>(null);
  const [path, setPath] = useState<{ generation: number; ids: number[] } | null>(null);

  useEffect(() => {
    let live = true;
    const finish = beginRefresh("charts");
    api.getCity(generation).then(
      (buffer) => {
        const data = parseCity(buffer);
        if (live && data.generation === generation) setLoaded({ data, finish });
      },
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, rev, onFail]);

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

  const data = loaded?.data.generation === generation ? loaded.data : null;
  const ids = path?.generation === generation ? path.ids : null;
  const focus = useMemo(() => (data && ids ? focusIn(data, ids) : null), [data, ids]);
  const city = useMemo(() => (data ? buildCity(data, focus) : null), [data, focus]);
  return { city, finish: data ? loaded!.finish : null };
}

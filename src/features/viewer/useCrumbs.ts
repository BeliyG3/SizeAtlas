import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Crumb } from "../../api/types";

const NONE: readonly Crumb[] = [];

/**
 * Path from the scan root to `id`; empty until the answer for this very `id` arrives. A change of
 * the tree (`rev`) asks again and keeps the old path until then.
 */
export function useCrumbs(
  generation: number,
  rev: number,
  id: number,
  onFail: (e: unknown) => void,
): readonly Crumb[] {
  const [loaded, setLoaded] = useState<{ id: number; crumbs: Crumb[] } | null>(null);
  useEffect(() => {
    let live = true;
    api.getCrumbs(generation, id).then(
      (crumbs) => live && setLoaded({ id, crumbs }),
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, rev, id, onFail]);
  return loaded?.id === id ? loaded.crumbs : NONE;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Roots } from "../api/types";
import { refreshInterval } from "../features/scan/cadence";
import { liveRoots } from "./liveRoots";

const EMPTY: Roots = { roots: [], queue: [] };

/** Serializes snapshot answers and coalesces only revisions of a first scan's live tree. */
export function useRootRefresh(onError: (e: unknown) => void) {
  const [roots, setRoots] = useState(EMPTY);
  const current = useRef(EMPTY);
  const times = useRef(new Map<number, number>());
  const asked = useRef(0);
  // An immediate refresh asked for since the last answer landed: a later request may supersede
  // it (the trash command also emits roots-changed), so the answer that lands applies it.
  const urgent = useRef(false);
  const lifecycle = useRef({ live: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const life = { live: true };
    lifecycle.current = life;
    return () => {
      life.live = false;
      clearTimeout(timer.current);
    };
  }, []);
  const refresh = useCallback(
    /** `now`: apply every revision at once, as after a change the user made (a trash). */
    function request(now = false): Promise<void> {
      const id = ++asked.current;
      if (now) urgent.current = true;
      const life = lifecycle.current;
      return api.listRoots().then(
        (next) => {
          if (!life.live || id !== asked.current) return;
          const immediate = urgent.current;
          urgent.current = false;
          const update = liveRoots(
            current.current,
            next,
            performance.now(),
            immediate ? 0 : refreshInterval("tree"),
            times.current,
          );
          current.current = update.roots;
          times.current = update.last;
          setRoots(update.roots);
          clearTimeout(timer.current);
          if (update.wait !== null) timer.current = setTimeout(() => void request(), update.wait);
        },
        (e: unknown) => {
          if (life.live && id === asked.current) onError(e);
        },
      );
    },
    [onError],
  );
  return { roots, refresh };
}

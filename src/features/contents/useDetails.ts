import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Detail } from "../../api/types";

/** The backend reads at most this many ids per call. */
const BATCH = 500;
/** Ids requested within this time go out together. */
const DELAY_MS = 100;

/**
 * Created/accessed times, attributes and owners of the rows the table shows, read from disk on
 * demand and kept for the generation (the viewer is recreated for every generation).
 */
export function useDetails(generation: number, onFail: (e: unknown) => void) {
  // ponytail: no eviction within one generation; details of every row ever shown stay (tens of
  // MB for a 300 000-entry folder scrolled end to end). Drop entries far from the view if needed.
  const [details, setDetails] = useState<ReadonlyMap<number, Detail>>(new Map());
  const asked = useRef(new Set<number>());
  const queue = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    timer.current = undefined;
    const ids = [...queue.current];
    queue.current.clear();
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      api.getDetails(generation, batch).then(
        (answer) => {
          if (answer.generation !== generation) return;
          setDetails((map) => {
            const next = new Map(map);
            for (const d of answer.items) next.set(d.id, d);
            return next;
          });
        },
        (e: unknown) => {
          for (const id of batch) asked.current.delete(id);
          onFail(e);
        },
      );
    }
  }, [generation, onFail]);

  const request = useCallback(
    (ids: readonly number[]) => {
      for (const id of ids) {
        if (asked.current.has(id)) continue;
        asked.current.add(id);
        queue.current.add(id);
      }
      if (queue.current.size > 0 && timer.current === undefined) {
        timer.current = setTimeout(flush, DELAY_MS);
      }
    },
    [flush],
  );

  useEffect(() => {
    const pending = timer;
    return () => {
      clearTimeout(pending.current);
      pending.current = undefined;
    };
  }, []);

  return { details, request };
}

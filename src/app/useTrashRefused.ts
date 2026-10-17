import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { QueueEntry } from "../api/types";

/** Questions still in flight, by key: the menus and the menu bar asking the same share one. */
const inFlight = new Map<string, Promise<boolean>>();

function askOnce(key: string, generation: number, rev: number, ids: number[]): Promise<boolean> {
  let asked = inFlight.get(key);
  if (!asked) {
    // Another error (a stale view) leaves the items available: the request itself reports it.
    asked = api
      .trashRefused(generation, rev, ids)
      .catch(() => false)
      .finally(() => inFlight.delete(key));
    inFlight.set(key, asked);
  }
  return asked;
}

/**
 * The backend's answer to whether the running `job` keeps one of `ids` of the tree with
 * `generation` at `rev` from going to the trash; undefined without a job or until the first
 * answer. Asked again when the tree or the job changes (a first scan finishes its folders one
 * after another); meanwhile the last answer for the same items holds, so the menu does not
 * flicker with each live update.
 */
export function useTrashRefused(
  job: QueueEntry | null,
  generation: number | null,
  rev: number | null,
  ids: readonly number[],
): boolean | undefined {
  const asks = job !== null && generation !== null && rev !== null && ids.length > 0;
  // Strings, so a new array of the same ids asks nothing.
  const items = asks ? JSON.stringify([generation, ids]) : null;
  const key = asks ? JSON.stringify([generation, rev, ids, job.root, job.folder]) : null;
  const [answer, setAnswer] = useState<{ items: string; refused: boolean } | null>(null);
  useEffect(() => {
    if (key === null || items === null) return;
    const [g, r, list] = JSON.parse(key) as [number, number, number[]];
    let current = true;
    void askOnce(key, g, r, list).then((refused) => {
      if (current) setAnswer({ items, refused });
    });
    return () => {
      current = false;
    };
  }, [key, items]);
  return answer !== null && answer.items === items ? answer.refused : undefined;
}

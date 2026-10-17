import { useEffect, useState } from "react";
import { api } from "../api/client";

/**
 * The backend's answer to whether a running scan keeps one of `ids` of the tree with `generation`
 * at `rev` from going to the trash; undefined while it is asked or when `ask` is false. Asked again
 * whenever the tree changes: a first scan finishes its folders one after another.
 */
export function useTrashRefused(
  ask: boolean,
  generation: number | null,
  rev: number | null,
  ids: readonly number[],
): boolean | undefined {
  // One string for the request, so a new array of the same ids asks nothing.
  const key =
    ask && generation !== null && rev !== null && ids.length > 0
      ? JSON.stringify([generation, rev, ids])
      : null;
  const [answer, setAnswer] = useState<{ key: string; refused: boolean } | null>(null);
  useEffect(() => {
    if (key === null) return;
    const [g, r, list] = JSON.parse(key) as [number, number, number[]];
    let current = true;
    const settle = (refused: boolean) => {
      if (current) setAnswer({ key, refused });
    };
    // Another error (a stale view) leaves the item available: the request itself reports it.
    api.trashRefused(g, r, list).then(settle, () => settle(false));
    return () => {
      current = false;
    };
  }, [key]);
  return answer !== null && answer.key === key ? answer.refused : undefined;
}

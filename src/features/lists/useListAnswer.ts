import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { List, ListKind } from "../../api/types";
import { useBatchCost } from "../scan/useBatchCost";
import { useLiveRevision } from "../scan/useLiveRevision";
import { isCleanupMode } from "./modes";
import { LIST_LIMIT } from "./rows";

interface Args {
  generation: number;
  /** A change of the tree or of its baseline lists again (`rev`, `baselineRev`). */
  rev: number;
  baselineRev: number;
  /** The folder whose subtree is listed. */
  base: number;
  kind: ListKind;
  /** The words of a "search" list. */
  query?: string;
  /** The tree is still being scanned (`Summary.scanning`). */
  liveScan: boolean;
  onFail: (e: unknown) => void;
}

/**
 * The answer on screen and the query it answers. The old rows stay, with their marks and cursor,
 * until the new answer comes; an answer to an older request that arrives late is dropped.
 */
export function useListAnswer({
  generation,
  rev,
  baselineRev,
  base,
  kind,
  query,
  liveScan,
  onFail,
}: Args) {
  const [answered, setAnswered] = useState<{ list: List; query: string } | null>(null);
  const list = answered?.list ?? null;
  // A clean-up list walks the whole tree (and reads the process list) for every answer, which
  // costs far more than the rows of a search: during a live scan it follows the slow cadence of
  // the charts, and its cost is booked there, so it does not slow the tree down. The list stays live.
  const cleanup = isCleanupMode(kind);
  const group = cleanup ? "charts" : "tree";
  const shownRev = useLiveRevision(rev, liveScan && cleanup, "charts");
  const measure = useBatchCost(group, list);
  useEffect(() => {
    let live = true;
    const applied = measure();
    const ask = (again: boolean) =>
      api.getList(generation, base, kind, LIST_LIMIT, query).then(
        (answer) => {
          if (!live) return;
          // A clean-up answer carries the revision of its walk: the tree changed after it, so
          // ask once more, which walks again. Once only: a busy tree must not keep it asking.
          if (again && cleanup && answer.rev < shownRev) {
            void ask(false);
            return;
          }
          applied();
          setAnswered({ list: answer, query: query ?? "" });
        },
        (e: unknown) => live && onFail(e),
      );
    void ask(true);
    return () => {
      live = false;
    };
  }, [generation, shownRev, baselineRev, base, kind, cleanup, query, onFail, measure]);
  return { list, shownQuery: answered?.query ?? "" };
}

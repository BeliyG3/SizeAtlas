import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { DEFAULT_ORDER } from "../../api/order";
import type { ChildrenPage } from "../../api/types";
import { TOP_SLICES } from "./slices";
import { measuredRead } from "../scan/cadence";

/** A page of the largest children and the folder it belongs to. */
export interface TopChildren {
  folder: number;
  page: ChildrenPage;
}

/**
 * The largest children of `folder` and the size of the rest; the previous folder's (or the
 * previous revision's) until loaded.
 */
export function useTopChildren(
  generation: number,
  rev: number,
  folder: number,
  onFail: (e: unknown) => void,
): TopChildren | null {
  const [page, setPage] = useState<TopChildren | null>(null);
  useEffect(() => {
    let live = true;
    measuredRead("charts", () =>
      api.getChildren(generation, folder, 0, TOP_SLICES, DEFAULT_ORDER),
    ).then(
      (p) => live && setPage({ folder, page: p }),
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, rev, folder, onFail]);
  return page;
}

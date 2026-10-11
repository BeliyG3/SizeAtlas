import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Item, ListOrder } from "../../api/types";
import { PAGE_SIZE } from "./pages";

/** Pages of one folder listing loaded so far. */
export interface Listing {
  /** Folder and order the pages belong to. */
  key: string;
  total: number;
  /** Size on disk of the folder: the base of the percentages. */
  size: number;
  // ponytail: no eviction within one listing; a 300 000-entry folder scrolled end to end keeps
  // every page (~50-100 MB). Evict pages far from the visible range if that ever matters.
  pages: ReadonlyMap<number, Item[]>;
}

/**
 * Pages of the listing of `folder` in `order`, fetched on request. Answers that arrive after
 * the folder, the order or the revision of the tree changed are dropped, so the table never
 * mixes two listings. `previous` is the last listing of the same folder in another order or
 * revision, shown dimmed meanwhile.
 */
export function useRowPages(
  generation: number,
  rev: number,
  folder: number,
  order: ListOrder,
  onFail: (e: unknown) => void,
) {
  // A change of the tree (a refresh, a trash) makes a new listing too.
  const key = `${folder}:${rev}:${order.key}:${order.descending}:${order.dirsOnly}`;
  const [listing, setListing] = useState<Listing | null>(null);
  const requested = useRef(new Set<number>());
  const current = useRef({ key, live: false });
  useLayoutEffect(() => {
    const scope = { key, live: true };
    current.current = scope;
    requested.current.clear();
    return () => {
      scope.live = false;
    };
  }, [key]);

  const request = useCallback(
    (pages: readonly number[]) => {
      // A timer set for the previous folder or order fires late: ignore it.
      const scope = current.current;
      if (!scope.live || scope.key !== key) return;
      for (const page of pages) {
        if (requested.current.has(page)) continue;
        requested.current.add(page);
        api.getChildren(generation, folder, page * PAGE_SIZE, PAGE_SIZE, order).then(
          (p) => {
            if (!scope.live) return;
            setListing((prev) => ({
              key,
              total: p.total,
              size: p.size,
              pages: new Map(prev?.key === key ? prev.pages : []).set(page, p.items),
            }));
          },
          (e: unknown) => {
            if (!scope.live) return;
            requested.current.delete(page);
            onFail(e);
          },
        );
      }
    },
    [generation, folder, order, key, onFail],
  );

  const shown = listing?.key === key ? listing : null;
  // A new order, filter or revision of the same folder: its old rows stay on screen (for display only)
  // until the first page of the new listing arrives, so a header click never blanks the table.
  const previous = !shown && listing?.key.startsWith(`${folder}:`) ? listing : null;
  return { listing: shown, previous, request };
}

/** The item at `index` of a listing, if its page is loaded. */
export function itemAt(listing: Listing | null, index: number): Item | undefined {
  return listing?.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
}

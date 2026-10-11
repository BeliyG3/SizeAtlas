import { useEffect, useMemo, useState } from "react";
import type { ListOrder } from "../../api/types";
import { PAGE_SIZE } from "./pages";
import { getRowPosition } from "./rowPosition";
import { itemAt, type Listing } from "./useRowPages";

interface Args {
  generation: number;
  listKey: string;
  order: ListOrder;
  listing: Listing | null;
  live: boolean;
  index: number | null;
  id: number | undefined;
  onFail: (e: unknown) => void;
}

/** Re-find a cursor or range anchor by item id when a live listing changes order. */
export function useRowPosition({
  generation,
  listKey,
  order,
  listing,
  live,
  index,
  id,
  onFail,
}: Args) {
  const loaded = useMemo(() => {
    if (!live || id === undefined || !listing) return null;
    for (const [page, items] of listing.pages) {
      const at = items.findIndex((item) => item.id === id);
      if (at !== -1) return page * PAGE_SIZE + at;
    }
    return null;
  }, [live, id, listing]);
  const key = `${generation}:${listKey}:${id}`;
  const revision = listing?.key;
  const [found, setFound] = useState<{ key: string; index: number | null } | null>(null);
  const needsPosition = live && index !== null && id !== undefined;

  useEffect(() => {
    if (!needsPosition || loaded !== null || id === undefined || revision === undefined) return;
    let current = true;
    getRowPosition(generation, id, order).then(
      (position) => {
        if (current) setFound({ key, index: position });
      },
      (error: unknown) => current && onFail(error),
    );
    return () => {
      current = false;
    };
  }, [needsPosition, loaded, id, generation, order, key, revision, onFail]);

  // Remember loaded positions too, before the item moves outside the fetched pages.
  if (loaded !== null && (found?.key !== key || found.index !== loaded)) {
    setFound({ key, index: loaded });
  }

  if (!needsPosition) return index;
  // Keep the last answer during a live tick, but never point at a different loaded item.
  const position = loaded ?? (found?.key === key ? found.index : index);
  const row = position === null ? undefined : itemAt(listing, position);
  return row && row.id !== id ? null : position;
}

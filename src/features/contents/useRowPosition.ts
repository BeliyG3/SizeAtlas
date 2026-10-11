import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ListOrder } from "../../api/types";
import { PAGE_SIZE } from "./pages";
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
  const key = `${generation}:${listKey}:${listing?.key}:${id}`;
  const [found, setFound] = useState<{ key: string; index: number | null } | null>(null);
  const needsPosition = live && index !== null && id !== undefined && listing !== null;

  useEffect(() => {
    if (!needsPosition || loaded !== null || id === undefined) return;
    let current = true;
    api.getPosition(generation, id, order).then(
      (position) => {
        if (current) setFound({ key, index: position });
      },
      (error: unknown) => current && onFail(error),
    );
    return () => {
      current = false;
    };
  }, [needsPosition, loaded, id, generation, order, key, onFail]);

  if (!needsPosition) return index;
  // Never let a held row index point at a different item while the lookup is pending.
  const position = loaded ?? (found?.key === key ? found.index : null);
  const row = position === null ? undefined : itemAt(listing, position);
  return row && row.id !== id ? null : position;
}

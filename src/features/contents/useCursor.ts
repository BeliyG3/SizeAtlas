import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { api } from "../../api/client";
import type { ListOrder } from "../../api/types";
import { HEADER_HEIGHT, scrollToShow } from "./pages";
import { itemAt, type Listing } from "./useRowPages";
import { useRowPosition } from "./useRowPosition";

/** Scrolls the table just enough to show row `index`. */
export function scrollToRow(el: HTMLElement, index: number) {
  const top = scrollToShow(index, el.scrollTop, el.clientHeight - HEADER_HEIGHT);
  if (top !== null) el.scrollTop = top;
}

interface Args {
  generation: number;
  folder: number;
  selectedId: number;
  order: ListOrder;
  /** Folder, order and filter of the listing shown. */
  listKey: string;
  /** Rows the listing has so far. */
  count: number;
  listing: Listing | null;
  live: boolean;
  /** The scrolling table. */
  body: RefObject<HTMLDivElement | null>;
  onFail: (e: unknown) => void;
}

/**
 * The cursor row of one listing (a new folder, order or filter starts without it). A file
 * selected elsewhere gets the cursor and is scrolled into view once its row exists.
 */
export function useCursor({
  generation,
  folder,
  selectedId,
  order,
  listKey,
  count,
  listing,
  live,
  body,
  onFail,
}: Args) {
  const [cursorAt, setCursorAt] = useState<{
    key: string;
    index: number;
    id?: number;
  } | null>(null);
  const cursor = useRowPosition({
    generation,
    listKey,
    order,
    listing,
    live,
    index: cursorAt?.key === listKey ? cursorAt.index : null,
    id: cursorAt?.id,
    onFail,
  });
  // A row to scroll to once the listing has that many rows.
  const pendingReveal = useRef<{ key: string; index: number } | null>(null);
  // A file the table itself selected: its row is known, so no position lookup is needed.
  const pickedHere = useRef<{ id: number; key: string } | null>(null);

  // Find the row of the selected file in the current order (none with "Folders only"). The
  // position usually arrives before the first page, while the list has no height yet, so the
  // scroll waits in pendingReveal until the rows are there.
  useEffect(() => {
    // A late answer would pull the cursor back after the user moved on.
    const picked = pickedHere.current;
    if (picked?.id === selectedId && picked.key === listKey) return;
    // Chosen elsewhere, or the folder itself: choosing the file again later must reveal it.
    pickedHere.current = null;
    if (selectedId === folder) return;
    let live = true;
    api.getPosition(generation, selectedId, order).then(
      (position) => {
        if (!live || position === null) return;
        pendingReveal.current = { key: listKey, index: position };
        setCursorAt({ key: listKey, index: position, id: selectedId });
      },
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, folder, selectedId, order, listKey, onFail]);

  useLayoutEffect(() => {
    const want = pendingReveal.current;
    const el = body.current;
    if (!want || !el || want.key !== listKey || want.index >= count) return;
    pendingReveal.current = null;
    scrollToRow(el, want.index);
  }, [listKey, count, cursorAt, body]);

  const setCursor = (index: number) =>
    setCursorAt({ key: listKey, index, id: itemAt(listing, index)?.id });
  /** Event handlers only: the table selected file `id` at the cursor. */
  const pickedFile = (id: number) => {
    pickedHere.current = { id, key: listKey };
  };
  return { cursor, setCursor, pickedFile };
}

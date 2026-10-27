import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { DupGroup, DupRef } from "../../../api/duplicates";
import { mimeOf } from "../thumbs";
import { pictureCopy } from "./useImageUrl";

/** What the viewer window is told to show: it reads the bytes itself. */
export interface ViewerPicture {
  ref: DupRef;
  name: string;
  key: string;
}

/** Main → viewer: the picture of the selected group, or null (nothing to show). */
export const SHOW_EVENT = "viewer-show";
/** Viewer → main: the window opened and asks for the picture. */
export const READY_EVENT = "viewer-ready";

export const showInViewer = (p: ViewerPicture | null): Promise<void> => emit(SHOW_EVENT, p);
export const onViewerReady = (run: () => void): Promise<UnlistenFn> =>
  listen(READY_EVENT, () => run());
export const onViewerShow = (run: (p: ViewerPicture | null) => void): Promise<UnlistenFn> =>
  listen<ViewerPicture | null>(SHOW_EVENT, (e) => run(e.payload));
export const viewerReady = (): Promise<void> => emit(READY_EVENT);

// An event nobody listens to is not an error; one that fails has nobody to tell either.
const send = (p: ViewerPicture | null) => void showInViewer(p).catch(() => {});

/**
 * Keeps the viewer window on the picture of `selected` (null for no picture type), and gives it
 * again whenever the window asks; the mode left (the hook gone) leaves it empty.
 */
export function useViewerSync(selected: DupGroup | null): void {
  const ref = selected && mimeOf(selected.name) !== null ? pictureCopy(selected) : null;
  // The same key, generation and id: the same picture (root and name follow from them).
  const { root = "", generation = 0, id = -1 } = ref ?? {};
  const key = ref ? (selected?.key ?? "") : null;
  const name = ref ? (selected?.name ?? "") : "";
  const current = useRef<ViewerPicture | null>(null);
  useEffect(() => {
    current.current = key === null ? null : { ref: { root, generation, id }, name, key };
    send(current.current);
  }, [key, root, generation, id, name]);
  useEffect(() => {
    let off = false;
    let un: UnlistenFn | undefined;
    onViewerReady(() => {
      // The listener of a cleaned-up effect, before its unlisten resolves.
      if (off) return;
      send(current.current);
    }).then((u) => (off ? u() : (un = u)));
    return () => {
      off = true;
      un?.();
      send(null);
    };
  }, []);
}

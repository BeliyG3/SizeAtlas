import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import type { DupGroup, DupRef } from "../../../api/duplicates";
import { mimeOf, type ThumbQueue } from "../thumbs";

export type Picture = { state: "loading" } | { state: "ready"; url: string } | { state: "none" };

const LOADING: Picture = { state: "loading" };
const NONE: Picture = { state: "none" };

/**
 * The path the picture of a group is read from (its copies are equal, so any one of them): a copy
 * not on a spinning disk if there is one, so the list never wakes a sleeping external disk then.
 */
export function pictureCopy(group: DupGroup): DupRef | null {
  return (group.copies.find((c) => !c.hdd) ?? group.copies[0])?.refs[0] ?? null;
}

/**
 * The picture of `group`, its URL shared through `queue` with everything else showing it. `none`
 * when there is none (not an image the webview shows, too large, in the cloud, gone, out of
 * view). Another file, or the same one read as another type, is `loading` until its own URL
 * comes, so a revoked URL is never given.
 */
export function useImageUrl(group: DupGroup | null, queue: ThumbQueue): Picture {
  const ref = group && pictureCopy(group);
  const type = group && ref ? mimeOf(group.name) : null;
  const { root = "", generation = 0, id = -1 } = ref ?? {};
  const file = type ? `${group?.key}|${type}|${root}|${generation}|${id}` : null;
  const [shown, setShown] = useState<{ file: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!file || !type) return;
    let live = true;
    queue
      .acquire(file, type, () => api.getThumbnail({ root, generation, id }))
      .then(
        (url) => live && setShown({ file, url }),
        // Out of view, or the backend failed.
        () => live && setShown({ file, url: null }),
      );
    return () => {
      live = false;
      queue.release(file);
    };
  }, [queue, file, type, root, generation, id]);
  if (!file) return NONE;
  if (shown?.file !== file) return LOADING;
  return shown.url ? { state: "ready", url: shown.url } : NONE;
}

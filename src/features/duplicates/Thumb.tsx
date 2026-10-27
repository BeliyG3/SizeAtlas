import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { DupGroup } from "../../api/duplicates";
import { ItemIcon } from "../contents/ItemIcon";
import { mimeOf, type ThumbQueue } from "./thumbs";

interface Props {
  group: DupGroup;
  queue: ThumbQueue;
  /** The picture of the copies pane, not the icon of a row. */
  large?: boolean;
}

/**
 * The picture of a group (its copies are equal, so any one of them), asked through `queue` by
 * the group's key; the icon of its category until it comes, and when there is none (not an image
 * the webview shows, too large, in the cloud, gone, out of view). Its object URL is revoked as
 * soon as another picture or none is shown.
 */
export function Thumb({ group, queue, large = false }: Props) {
  const { key, name } = group;
  const { root = "", generation = 0, id = -1 } = group.copies[0]?.refs[0] ?? {};
  const type = id < 0 ? null : mimeOf(name);
  // The picture belongs to one file read as one type: anything else shows the icon until its own
  // comes, so a revoked URL never stays on screen.
  const file = `${key}|${type}|${root}|${generation}|${id}`;
  const [shown, setShown] = useState<{ file: string; url: string } | null>(null);
  useEffect(() => {
    if (!type) return;
    let live = true;
    let url: string | null = null;
    queue
      .request(key, () => api.getThumbnail({ root, generation, id }))
      .then(
        (bytes) => {
          if (!live || bytes.byteLength === 0) return;
          url = URL.createObjectURL(new Blob([bytes], { type }));
          setShown({ file, url });
        },
        // Out of view, or the backend failed: the icon stays.
        () => {},
      );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [queue, key, file, type, root, generation, id]);
  if (shown?.file !== file) return <ItemIcon isDir={false} category={group.category} />;
  return <img className={large ? "dup-picture" : "dup-thumb"} src={shown.url} alt="" />;
}

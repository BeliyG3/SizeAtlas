import { useState } from "react";
import type { DupGroup } from "../../api/duplicates";
import { ItemIcon } from "../contents/ItemIcon";
import type { ThumbQueue } from "./thumbs";
import { useImageUrl } from "./viewer/useImageUrl";

interface Props {
  group: DupGroup;
  queue: ThumbQueue;
}

/**
 * The picture of a group (`useImageUrl`); the icon of its category until it comes, when there is
 * none, and when the webview cannot decode it.
 */
export function Thumb({ group, queue }: Props) {
  const picture = useImageUrl(group, queue);
  const [broken, setBroken] = useState<string | null>(null);
  if (picture.state !== "ready" || picture.url === broken) {
    return <ItemIcon isDir={false} category={group.category} />;
  }
  return (
    <img className="dup-thumb" src={picture.url} alt="" onError={() => setBroken(picture.url)} />
  );
}

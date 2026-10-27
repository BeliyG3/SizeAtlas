import { useEffect, useRef, useState } from "react";
import type { DupGroup } from "../../api/duplicates";
import { ItemIcon } from "../contents/ItemIcon";
import type { ThumbQueue } from "./thumbs";
import { HoverZoom } from "./viewer/HoverZoom";
import { HOVER_DELAY } from "./viewer/hover";
import { useImageUrl } from "./viewer/useImageUrl";
import type { Point } from "./viewer/zoom";

interface Props {
  group: DupGroup;
  queue: ThumbQueue;
}

/** Hidden (null), pending (waiting out `HOVER_DELAY`) or shown; the pointer all along. */
type Hover = { at: Point; shown: boolean } | null;

// Anything that moves the list under the pointer or takes the user elsewhere hides the popup.
const DISMISS = ["pointerdown", "keydown", "wheel"] as const;

/**
 * The picture of a group (`useImageUrl`); the icon of its category until it comes, when there is
 * none, and when the webview cannot decode it. Resting the pointer on the picture shows a larger
 * copy of it (the same URL) next to the pointer.
 */
export function Thumb({ group, queue }: Props) {
  const picture = useImageUrl(group, queue);
  const [broken, setBroken] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const url = picture.state === "ready" && picture.url !== broken ? picture.url : null;

  const hide = () => {
    clearTimeout(timer.current);
    setHover(null);
  };
  const point = (e: { clientX: number; clientY: number }) => {
    if (!url) return;
    const at = { x: e.clientX, y: e.clientY };
    if (hover?.shown) return setHover({ at, shown: true });
    clearTimeout(timer.current);
    setHover({ at, shown: false });
    timer.current = setTimeout(() => setHover((h) => h && { ...h, shown: true }), HOVER_DELAY);
  };

  // Another picture, or none: nothing to zoom any more. Also hides it on unmount.
  useEffect(() => hide, [url]);
  const active = hover !== null;
  useEffect(() => {
    if (!active) return;
    window.addEventListener("scroll", hide, true);
    for (const type of DISMISS) window.addEventListener(type, hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      for (const type of DISMISS) window.removeEventListener(type, hide);
    };
  }, [active]);

  if (!url) return <ItemIcon isDir={false} category={group.category} />;
  return (
    <>
      <img
        className="dup-thumb"
        src={url}
        alt=""
        onError={() => setBroken(url)}
        onPointerEnter={point}
        onPointerMove={point}
        onPointerLeave={hide}
      />
      {hover?.shown && <HoverZoom url={url} at={hover.at} />}
    </>
  );
}

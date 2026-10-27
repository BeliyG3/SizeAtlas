import { useState } from "react";
import { createPortal } from "react-dom";
import { fitPopup, placePopup, popupSize } from "./hover";
import type { Point, Size } from "./zoom";
import "./viewer.css";

interface Props {
  url: string;
  /** The pointer, in window pixels. */
  at: Point;
}

/**
 * A larger copy of a thumbnail next to the pointer, over everything, never taking its events: in
 * the shape of the picture, hidden until it has loaded and that shape is known.
 */
export function HoverZoom({ url, at }: Props) {
  const [natural, setNatural] = useState<{ url: string; size: Size } | null>(null);
  const known = natural?.url === url;
  const view = { w: window.innerWidth, h: window.innerHeight };
  const limit = popupSize(view);
  const size = known ? fitPopup(natural.size, limit) : limit;
  const { x, y } = placePopup(at, size, view);
  return createPortal(
    <img
      className="hover-zoom"
      src={url}
      alt=""
      style={{
        left: x,
        top: y,
        width: size.w,
        height: size.h,
        visibility: known ? undefined : "hidden",
      }}
      onLoad={(e) =>
        setNatural({
          url,
          size: { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight },
        })
      }
    />,
    document.body,
  );
}

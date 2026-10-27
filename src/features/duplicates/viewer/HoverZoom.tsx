import { createPortal } from "react-dom";
import { placePopup, popupSize } from "./hover";
import type { Point } from "./zoom";
import "./viewer.css";

interface Props {
  url: string;
  /** The pointer, in window pixels. */
  at: Point;
}

/** A larger copy of a thumbnail next to the pointer, over everything, never taking its events. */
export function HoverZoom({ url, at }: Props) {
  const view = { w: window.innerWidth, h: window.innerHeight };
  const size = popupSize(view);
  const { x, y } = placePopup(at, size, view);
  return createPortal(
    <img
      className="hover-zoom"
      src={url}
      alt=""
      style={{ left: x, top: y, width: size.w, height: size.h }}
    />,
    document.body,
  );
}

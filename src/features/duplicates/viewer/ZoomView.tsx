import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import {
  WHEEL_STEP,
  canPan,
  fitView,
  panBy,
  toggleActual,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "./zoom";
import "./viewer.css";

interface Props {
  url: string;
  label: string;
  /** A click on the empty space around the picture (not the end of a drag). */
  onBackground?: () => void;
}

interface Zoom {
  /** The URL whose natural size `image` is; another one is hidden until it loads. */
  url: string;
  image: Size;
  box: Size;
  view: View;
}

const NOTHING: Size = { w: 0, h: 0 };
/** A press that moves less than this (px) is still a click. */
const CLICK_SLOP = 3;

const pointIn = (el: Element, e: { clientX: number; clientY: number }): Point => {
  const rect = el.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

/**
 * A picture filling its parent: fitted (never above its actual size) on a new URL and on a
 * resize; the wheel zooms at the pointer, a drag pans, a double click toggles fit and 1:1.
 */
export function ZoomView({ url, label, onBackground }: Props): ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>({
    url: "",
    image: NOTHING,
    box: NOTHING,
    view: fitView(NOTHING, NOTHING),
  });
  const press = useRef<{ x: number; y: number; from: Point } | null>(null);
  /** The press began on the empty space and has not dragged: its click is a background click. */
  const backgroundClick = useRef(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const resized = new ResizeObserver(([entry]) => {
      const box = { w: entry.contentRect.width, h: entry.contentRect.height };
      // A minimized window, or a pane not laid out yet.
      if (box.w <= 0 || box.h <= 0) return;
      setZoom((z) => ({ ...z, box, view: fitView(z.image, box) }));
    });
    resized.observe(el);
    // Native, not passive: the wheel must not scroll anything underneath.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const at = pointIn(el, e);
      setZoom((z) => ({ ...z, view: zoomAt(z.view, z.image, z.box, factor, at) }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resized.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The capture makes the container the target of the click: remember what was pressed.
    backgroundClick.current = e.target === e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY } };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.abs(e.clientX - p.from.x) + Math.abs(e.clientY - p.from.y) > CLICK_SLOP) {
      backgroundClick.current = false;
    }
    setZoom((z) => ({ ...z, view: panBy(z.view, z.image, z.box, dx, dy) }));
  };
  const up = () => {
    press.current = null;
  };

  const shown = zoom.url === url;
  const { scale, x, y } = zoom.view;
  return (
    <div
      ref={boxRef}
      className="zoom-view"
      style={{ cursor: shown && canPan(zoom.view, zoom.image, zoom.box) ? "grab" : undefined }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => {
        if (e.target === e.currentTarget && backgroundClick.current) onBackground?.();
      }}
      onDoubleClick={(e) => {
        const at = pointIn(e.currentTarget, e);
        setZoom((z) => ({ ...z, view: toggleActual(z.view, z.image, z.box, at) }));
      }}
    >
      <img
        src={url}
        alt={label}
        draggable={false}
        style={{
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          visibility: shown ? undefined : "hidden",
        }}
        onLoad={(e) => {
          const image = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
          setZoom((z) => ({ ...z, url, image, view: fitView(image, z.box) }));
        }}
      />
    </div>
  );
}

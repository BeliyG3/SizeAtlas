/** Mouse input on the city canvas besides the camera's own: hover, click and double click. */
import type { Building } from "./world/buildings";

/** A pointer movement shorter than this, in CSS pixels, between press and release is a click. */
const CLICK_SLOP = 4;

export interface Hover {
  building: Building;
  /** Pointer position and canvas size, in CSS pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PointerHandlers {
  /** The house or filler under a canvas point, or null. */
  pick: (x: number, y: number) => Building | null;
  onHover: (hover: Hover | null) => void;
  onPick: (building: Building) => void;
  onFly: (building: Building) => void;
}

/**
 * Hover picks at most once per frame and never while a button is held (the camera is moving);
 * a press released within `CLICK_SLOP` picks; a double click flies (its first click picked).
 * Returns the detach function.
 */
export function attachPointer(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void {
  let frame = 0;
  let last: { x: number; y: number } | null = null;
  let down: { x: number; y: number } | null = null;

  const point = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    handlers.onHover(null);
  };
  const move = (e: PointerEvent) => {
    if (e.buttons !== 0) return;
    last = point(e);
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (!last) return;
      const { x, y } = last;
      const building = handlers.pick(x, y);
      handlers.onHover(
        building && { building, x, y, w: canvas.clientWidth, h: canvas.clientHeight },
      );
    });
  };
  const press = (e: PointerEvent) => {
    down = point(e);
    clear();
  };
  const release = (e: PointerEvent) => {
    const from = down;
    down = null;
    if (!from || e.button !== 0) return;
    const { x, y } = point(e);
    if (Math.hypot(x - from.x, y - from.y) >= CLICK_SLOP) return;
    const building = handlers.pick(x, y);
    if (building) handlers.onPick(building);
  };
  const double = (e: MouseEvent) => {
    const { x, y } = point(e);
    const building = handlers.pick(x, y);
    if (building) handlers.onFly(building);
  };

  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", clear);
  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("dblclick", double);
  return () => {
    cancelAnimationFrame(frame);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", clear);
    canvas.removeEventListener("pointerdown", press);
    canvas.removeEventListener("pointerup", release);
    canvas.removeEventListener("dblclick", double);
  };
}

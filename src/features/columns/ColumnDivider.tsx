import type { KeyboardEvent, PointerEvent } from "react";
import { historyKey } from "../shell/historyKey";
import { MAX_WIDTH, MIN_WIDTH, clampWidth, resizeStep } from "./fit";
import "./columns.css";

interface Props {
  /** Accessible name, e.g. "Width of the Size column". */
  label: string;
  /** Current width of the column it sizes. */
  width: number;
  /** Edge of that column the border sits on: "left" for a column that grows to the left. */
  side?: "left" | "right";
  /** Live while dragging; `done` on release or a key press, when the width should be stored. */
  onResize: (width: number, done: boolean) => void;
  /** Double-click or Enter: size the column to its content. */
  onFit: () => void;
}

/**
 * A column border in a header: drag it (the pointer is captured), double-click it to fit the
 * column, or focus it and use the arrow keys (Shift: bigger steps) and Enter.
 */
export function ColumnDivider({ label, width, side = "right", onResize, onFit }: Props) {
  const sign = side === "right" ? 1 : -1;

  const startDrag = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    // The header cell under it would start moving its column.
    e.stopPropagation();
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let last = width;
    const events = {
      pointermove: move,
      pointerup: stop,
      pointercancel: stop,
      lostpointercapture: stop,
    };
    function move(ev: globalThis.PointerEvent) {
      // The button came up where no pointerup reached us.
      if (ev.buttons === 0) return stop(ev);
      last = clampWidth(width + sign * (ev.clientX - startX));
      onResize(last, false);
    }
    // Released: the new width is stored. Anything else (cancelled, capture lost to Alt+Tab or a
    // dialog): the width it started with is put back. Pointerup comes before the lost capture.
    function stop(ev: globalThis.PointerEvent) {
      for (const [name, listener] of Object.entries(events)) {
        handle.removeEventListener(name, listener as EventListener);
      }
      onResize(ev.type === "pointerup" ? last : width, true);
    }
    for (const [name, listener] of Object.entries(events)) {
      handle.addEventListener(name, listener as EventListener);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (historyKey(e) !== null) return;
    const step = resizeStep(e.key, e.shiftKey);
    if (step !== null) onResize(clampWidth(width + sign * step), true);
    else if (e.key === "Enter") onFit();
    else return;
    // The table and tree act on these keys too.
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <span
      className={`col-divider ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      // Neither sorts nor reaches the header cell under it.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFit();
      }}
    />
  );
}

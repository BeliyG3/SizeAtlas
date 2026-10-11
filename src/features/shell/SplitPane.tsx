import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { parseSize } from "../../settings/settings";
import { readStored, writeStored } from "../../settings/storage";
import { historyKey } from "./historyKey";
import { MIN_PANE, SPLITTER, clampPane, keyStep } from "./split";

interface Props {
  /** "row": panes side by side; "column": one above the other. */
  direction: "row" | "column";
  /** The pane whose size is stored; the other one takes the rest. */
  sized: "first" | "second";
  storageKey: string;
  defaultSize: number;
  /** Accessible name of the border. */
  label: string;
  first: ReactNode;
  second: ReactNode;
  /**
   * Hides this pane and the border; the other pane takes all the room. Its size stays stored
   * for when it comes back.
   */
  collapse?: "first" | "second";
}

/** Two panes and a border that can be dragged or moved with arrow keys; the size is remembered. */
export function SplitPane({
  direction,
  sized,
  storageKey,
  defaultSize,
  label,
  first,
  second,
  collapse,
}: Props) {
  const [size, setSize] = useState(() => parseSize(readStored(storageKey), defaultSize));
  const box = useRef<HTMLDivElement>(null);
  const row = direction === "row";
  // Moving the border towards the second pane grows the first one.
  const sign = sized === "first" ? 1 : -1;

  /** Called from event handlers only: reads the container size at that moment. */
  const limit = (value: number) => {
    const el = box.current;
    return el ? clampPane(value, row ? el.clientWidth : el.clientHeight) : value;
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = row ? e.clientX : e.clientY;
    const from = size;
    let last = from;
    const move = (ev: globalThis.PointerEvent) => {
      last = limit(from + sign * ((row ? ev.clientX : ev.clientY) - start));
      setSize(last);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", stop);
    };
    // Stored once, when the drag ends, not on every move.
    const end = () => {
      stop();
      writeStored(storageKey, String(last));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", stop);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (historyKey(e) !== null) return;
    const step = keyStep(e.key, e.shiftKey, row);
    if (step === null) return;
    e.preventDefault();
    const next = limit(size + sign * step);
    setSize(next);
    writeStored(storageKey, String(next));
  };

  // The CSS limit keeps the other pane visible when the window shrinks below the stored size.
  const style: CSSProperties = {
    [row ? "width" : "height"]: `min(${size}px, calc(100% - ${MIN_PANE + SPLITTER}px))`,
  };
  // The same three boxes in every state, so the pane that stays shown is never recreated (the
  // folder tree keeps its expanded folders); a hidden pane renders nothing.
  const pane = (which: "first" | "second") => {
    if (collapse === which) return <div className="pane" hidden />;
    const content = which === "first" ? first : second;
    if (collapse === undefined && which === sized)
      return (
        <div className="pane sized" style={style}>
          {content}
        </div>
      );
    return <div className="pane rest">{content}</div>;
  };
  return (
    <div className={`split ${direction}`} ref={box}>
      {pane("first")}
      <div
        className="splitter"
        hidden={collapse !== undefined}
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-valuenow={size}
        aria-valuemin={MIN_PANE}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
      />
      {pane("second")}
    </div>
  );
}

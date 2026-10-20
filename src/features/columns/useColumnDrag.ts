import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { dropEdge, dropIndex, ghostLeft } from "./order";

/** Pixels the pointer must travel before pressing a header becomes dragging it. */
const THRESHOLD = 5;

/** What DragGhost draws while a header is dragged, in viewport coordinates. */
export interface DragView {
  /** The header's label, without its sort arrow. */
  label: string;
  /** Font, alignment and side padding of the dragged header, so the ghost reads like it. */
  font: string;
  /** The label sits at the inline-end edge, as the ghost's own direction (the page's) reads it. */
  alignEnd: boolean;
  padding: string;
  ghost: { left: number; top: number; width: number; height: number };
  /** Where the column would drop: a line across the header. */
  line: { left: number; top: number; height: number };
}

type Align = Pick<CSSStyleDeclaration, "textAlign" | "justifyContent">;

/**
 * Whether computed styles put a label at the inline-end edge: `flex-end` and `end` are logical,
 * a physical `right` (or `left` in right-to-left layouts) is the end too.
 */
export function alignsEnd(s: Align, rtl: boolean): boolean {
  if (s.justifyContent === "flex-end" || s.justifyContent === "end") return true;
  return s.textAlign === "end" || s.textAlign === (rtl ? "left" : "right");
}

/** How the label of a header cell looks: its text sits in the cell's sort button, if any. */
function lookOf(cell: HTMLElement, rtl: boolean) {
  const text = cell.querySelector<HTMLElement>(".col-sort, .label") ?? cell;
  const [inner, outer] = [getComputedStyle(text), getComputedStyle(cell)];
  return {
    // Every header renders its label in an `.ellipsis` span, next to the arrow.
    label: (cell.querySelector(".ellipsis") ?? cell).textContent ?? "",
    font: outer.font,
    alignEnd: alignsEnd(inner, rtl) || alignsEnd(outer, rtl),
    padding: `0 ${inner.paddingRight} 0 ${inner.paddingLeft}`,
  };
}

/** Left and right edges of the part of `el` that its scrolling container shows. */
function visibleSpan(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  let left = box.left;
  let right = box.right;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === "visible") continue;
    const view = p.getBoundingClientRect();
    left = Math.max(left, view.left + p.clientLeft);
    right = Math.min(right, view.left + p.clientLeft + p.clientWidth);
    break;
  }
  return { left, right };
}

/**
 * Moving a column by dragging its header cell left or right, as in Windows Explorer. The header
 * cells (each with `data-col`) are the children of one row element; `ids` names them in order.
 * A `pinned` column (first in `ids`) cannot be moved and nothing drops before it.
 */
export function useColumnDrag<K extends string>(
  ids: readonly K[],
  onMove: (id: K, before: K | null) => void,
  pinned?: K,
) {
  const [drag, setDrag] = useState<{ id: K; view: DragView } | null>(null);
  const dropped = useRef(false);
  const rtl = isRtl(useT().lang);

  /** Pointer down on the header cell of column `id`. */
  const start = (id: K, e: PointerEvent<HTMLElement>) => {
    dropped.current = false;
    if (e.button !== 0 || id === pinned) return;
    const cell = e.currentTarget;
    const head = cell.parentElement;
    if (!head) return;
    const pointer = e.pointerId;
    const startX = e.clientX;
    const area = head.getBoundingClientRect();
    // The ghost stays over the visible part of the header, never over a neighbouring panel.
    const shown = visibleSpan(head);
    const own = cell.getBoundingClientRect();
    const boxes = [...head.querySelectorAll(":scope > [data-col]")].map((c) =>
      c.getBoundingClientRect(),
    );
    const centers = boxes.map((b) => (b.left + b.right) / 2);
    const look = lookOf(cell, rtl);
    let at: number | null = null;

    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      // The button came up where no pointerup reached us.
      if (ev.buttons === 0) return end(ev);
      if (at === null) {
        // A plain click sorts: the cell takes the pointer only once it really moves.
        if (Math.abs(ev.clientX - startX) < THRESHOLD) return;
        cell.setPointerCapture(pointer);
      }
      at = Math.max(pinned === undefined ? 0 : 1, dropIndex(centers, ev.clientX, rtl));
      const edge = dropEdge(boxes, at, rtl);
      const left = ghostLeft(ev.clientX, startX - own.left, own.width, shown.left, shown.right);
      setDrag({
        id,
        view: {
          ...look,
          ghost: { left, top: own.top, width: own.width, height: own.height },
          line: {
            left: Math.max(shown.left, Math.min(shown.right, edge)),
            top: area.top,
            height: area.height,
          },
        },
      });
    };
    // Pointerup drops the column. Anything else (cancelled, capture lost to Alt+Tab or a dialog)
    // leaves the order as it was. Pointerup comes before the lost capture.
    const end = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cell.removeEventListener("lostpointercapture", end);
      if (at === null) return;
      setDrag(null);
      if (ev.type !== "pointerup") return;
      // Swallows the click that follows this pointerup, and nothing later (a key's click).
      dropped.current = true;
      setTimeout(() => (dropped.current = false));
      onMove(id, ids[at] ?? null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    cell.addEventListener("lostpointercapture", end);
  };

  /** Capture-phase click handler of the header cells: the click that ends a drag does not sort. */
  const suppressClick = (e: MouseEvent) => {
    if (!dropped.current) return;
    e.stopPropagation();
    e.preventDefault();
  };

  return { dragging: drag?.id ?? null, view: drag?.view ?? null, start, suppressClick };
}

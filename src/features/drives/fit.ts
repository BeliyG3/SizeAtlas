import { useEffect, useState, type RefObject } from "react";
import { fitWidth, measureColumn } from "../columns/fit";
import type { DriveColumn } from "./sort";

/** The name column never gets narrower than this: the panel scrolls instead. */
export const MIN_NAME = 100;

type Widths = Readonly<Record<DriveColumn, number>>;

const COLUMNS: readonly DriveColumn[] = ["name", "size", "used", "free"];

/** Width the drives table needs: the name column as fitted (at least MIN_NAME) and the numbers. */
export const drivesWidth = (widths: Widths) =>
  Math.max(MIN_NAME, widths.name) + widths.size + widths.used + widths.free;

/**
 * Widths that fit each column's header and cells as rendered in `box`, so the default layout
 * shows the sizes and names in full in every language and unit. Measured again whenever the text
 * in the box or its size changes; a new value only when a width changed.
 */
export function useFittedWidths(box: RefObject<HTMLElement | null>): Widths | null {
  const [fitted, setFitted] = useState<Widths | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const next = Object.fromEntries(
        COLUMNS.map((id) => [id, fitWidth(measureColumn(el, id))]),
      ) as Record<DriveColumn, number>;
      setFitted((prev) => (prev && COLUMNS.every((id) => prev[id] === next[id]) ? prev : next));
    };
    // Measuring only touches the cells' style attributes, which neither observer watches.
    const resized = new ResizeObserver(measure);
    const changed = new MutationObserver(measure);
    resized.observe(el);
    changed.observe(el, { subtree: true, childList: true, characterData: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [box]);
  return fitted;
}

import { useState } from "react";
import { useStored } from "../../settings/storage";
import { columnWidths, storedWidths } from "./fit";

const serialize = (widths: object) => JSON.stringify(widths);
const NONE = {};

/**
 * Column widths stored under `key` (one number per column id): live while a border is dragged,
 * stored when the drag ends. `defaults` must be a module-level constant; `fitted` (widths that
 * fit the content) stand in for the defaults of columns the user has not sized.
 */
export function useColumnWidths<K extends string>(
  key: string,
  defaults: Readonly<Record<K, number>>,
  fitted: Partial<Record<K, number>> = NONE,
) {
  const [stored, store] = useStored<Partial<Record<K, number>>>(
    key,
    (raw) => storedWidths(raw, defaults),
    serialize,
  );
  const [dragged, setDragged] = useState<Partial<Record<K, number>> | null>(null);
  const widths = columnWidths(defaults, fitted, dragged ?? stored);
  /** A border moved to `width`; `done` when the drag ends (or for a key press, a fit). */
  const resize = (id: K, width: number, done: boolean) => {
    // Only the columns the user sized are stored: the others keep following their content.
    const next = { ...stored, [id]: width };
    if (done) store(next);
    setDragged(done ? null : next);
  };
  return { widths, resize, store };
}

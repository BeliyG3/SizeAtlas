import { useState } from "react";
import { useStored } from "../../settings/storage";
import { parseWidths } from "./fit";

const serialize = (widths: object) => JSON.stringify(widths);

/**
 * Column widths stored under `key` (one number per column id): live while a border is dragged,
 * stored when the drag ends. `defaults` must be a module-level constant.
 */
export function useColumnWidths<K extends string>(
  key: string,
  defaults: Readonly<Record<K, number>>,
) {
  const [stored, store] = useStored<Readonly<Record<K, number>>>(
    key,
    (raw) => parseWidths(raw, defaults),
    serialize,
  );
  const [dragged, setDragged] = useState<Readonly<Record<K, number>> | null>(null);
  const widths = dragged ?? stored;
  /** A border moved to `width`; `done` when the drag ends (or for a key press, a fit). */
  const resize = (id: K, width: number, done: boolean) => {
    const next = { ...widths, [id]: width };
    if (done) store(next);
    setDragged(done ? null : next);
  };
  return { widths, resize, store };
}

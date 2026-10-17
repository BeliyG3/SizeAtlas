import { createContext, useContext } from "react";

/** The items of the running trash request, by tree: their rows are dimmed until it ends. */
export interface Moving {
  generation: number;
  ids: ReadonlySet<number>;
}

export const MovingContext = createContext<Moving | null>(null);

const NONE: ReadonlySet<number> = new Set();

/** Ids of the tree with `generation` that are being moved to the trash now. */
export function useMovingIds(generation: number): ReadonlySet<number> {
  const moving = useContext(MovingContext);
  return moving?.generation === generation ? moving.ids : NONE;
}

import { createContext, useContext } from "react";

/** The items of the running trash request, by tree: their rows are dimmed until it ends. */
export interface Moving {
  generation: number;
  ids: ReadonlySet<number>;
  /** They are deleted for good, not moved to the trash. */
  purge: boolean;
}

export const MovingContext = createContext<Moving | null>(null);

const NONE: ReadonlySet<number> = new Set();

/** How the rows of the tree with `generation` go now: to the trash, for good, or not at all. */
export function useMoving(generation: number): (id: number) => "trash" | "purge" | undefined {
  const moving = useContext(MovingContext);
  const ids = moving?.generation === generation ? moving.ids : NONE;
  const how = moving?.purge ? "purge" : "trash";
  return (id) => (ids.has(id) ? how : undefined);
}

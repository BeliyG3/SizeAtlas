import { createContext, useContext } from "react";
import { removingState, type RemovingState, type Run } from "./runs";

/** The removal requests, started or waiting: their rows are dimmed until each one ends. */
export const MovingContext = createContext<readonly Run[]>([]);

/** How the rows of the tree with `generation` go now: waiting, to the trash, for good, or not at all. */
export function useMoving(generation: number): (id: number) => RemovingState | undefined {
  const runs = useContext(MovingContext);
  return (id) => removingState(runs, generation, id);
}

import { scanActions } from "../features/scan/actions";
import type { RootEntry } from "./roots";

/** Item menu actions follow the item's tree, even when another root is selected. */
export function itemMenuActions(
  entries: readonly RootEntry[],
  generation: number | undefined,
  fullScans: ReadonlySet<string>,
) {
  const root =
    generation === undefined
      ? undefined
      : entries.find((entry) => entry.summary?.generation === generation)?.root;
  return scanActions(root === undefined || fullScans.has(root));
}

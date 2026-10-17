import { scanActions } from "../features/scan/actions";
import type { RootEntry } from "./roots";

/**
 * Item menu actions follow the item's tree, even when another root is selected. A root whose
 * items move to the trash cannot be refreshed meanwhile: `refreshNote` says why.
 */
export function itemMenuActions(
  entries: readonly RootEntry[],
  generation: number | undefined,
  fullScans: ReadonlySet<string>,
  trashingRoot: string | null = null,
) {
  const root =
    generation === undefined
      ? undefined
      : entries.find((entry) => entry.summary?.generation === generation)?.root;
  const actions = scanActions(root === undefined || fullScans.has(root));
  const trashing = root !== undefined && root === trashingRoot;
  return {
    ...actions,
    refresh: actions.refresh && !trashing,
    refreshNote: trashing ? "trash.busy" : undefined,
  };
}

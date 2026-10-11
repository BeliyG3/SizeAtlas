import { ROOT_ID } from "../api/types";
import type { RootEntry } from "./roots";

/** The selected node; `folder` is the node itself if it is a folder, else its parent. */
export interface Selection {
  readonly root: string;
  /** Tree the ids belong to; null for a root that has no tree yet. */
  readonly generation: number | null;
  readonly id: number;
  readonly folder: number;
  /** Set when a change removed node `fallbackOf` and the selection fell back to `id`. */
  readonly fallbackOf?: number;
}

export const rootSelection = (root: string, generation: number | null = null): Selection => ({
  root,
  generation,
  id: ROOT_ID,
  folder: ROOT_ID,
});

/**
 * What the view shows for the user's choice: the chosen node while its root keeps that tree;
 * the root of the new tree after a rescan or a reopen; the first root when the chosen one is
 * not listed (closed). While the saved scans are still being reopened (`restoring`), a chosen
 * root that is not listed yet stays chosen, so the view does not show another root meanwhile.
 */
export function resolveSelection(
  chosen: Selection | null,
  entries: readonly RootEntry[],
  restoring = false,
): Selection | null {
  const entry =
    entries.find((e) => e.root === chosen?.root) ?? (restoring && chosen ? null : entries[0]);
  if (!entry) return restoring ? chosen : null;
  const generation = entry.summary?.generation ?? null;
  return chosen?.root === entry.root && chosen.generation === generation
    ? chosen
    : rootSelection(entry.root, generation);
}

/**
 * The root to select once `root` has left the list (`before` → `after`): the nearest root after
 * it that is still listed, else the nearest one before it. Null while `root` is listed.
 */
export function neighbour(
  before: readonly RootEntry[],
  after: readonly RootEntry[],
  root: string,
): string | null {
  const listed = new Set(after.map((e) => e.root));
  const at = before.findIndex((e) => e.root === root);
  if (at < 0 || listed.has(root)) return null;
  const stays = (e: RootEntry) => listed.has(e.root);
  return (
    (before.slice(at + 1).find(stays) ?? before.slice(0, at).reverse().find(stays))?.root ?? null
  );
}

/**
 * The choice once the list changes from `before` to `after`: the neighbour of a chosen root that
 * left, the chosen root with the tree it has now, or `chosen` itself while nothing changed for it
 * (also for a remembered root that is not listed yet). Keeping the tree in the choice keeps the
 * resolved selection the same object across unrelated changes of the list.
 */
export function followEntries(
  chosen: Selection | null,
  before: readonly RootEntry[],
  after: readonly RootEntry[],
): Selection | null {
  if (!chosen) return null;
  const next = neighbour(before, after, chosen.root);
  if (next) return resolveSelection(rootSelection(next), after);
  return after.some((e) => e.root === chosen.root) ? resolveSelection(chosen, after) : chosen;
}

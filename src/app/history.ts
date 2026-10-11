import { ROOT_ID } from "../api/types";
import type { RootEntry } from "./roots";
import type { Selection } from "./selection";

/** A folder the view showed: its root and the tree its id belongs to. */
export interface Visit {
  readonly root: string;
  readonly generation: number | null;
  readonly folder: number;
}

/** Visited folders, oldest first; `at` is the one shown now, -1 while empty. */
export interface History {
  readonly entries: readonly Visit[];
  readonly at: number;
}

export const HISTORY_LIMIT = 100;
export const emptyHistory: History = { entries: [], at: -1 };

const same = (a: Visit, b: Visit) =>
  a.root === b.root && a.generation === b.generation && a.folder === b.folder;

export const toVisit = ({ root, generation, folder }: Selection): Visit => ({
  root,
  generation,
  folder,
});

/** Adds `v` after the current entry, dropping the forward ones; the current folder is not repeated. */
export function visit(h: History, v: Visit, limit = HISTORY_LIMIT): History {
  const current = h.entries[h.at];
  if (current && same(current, v)) return h;
  const entries = [...h.entries.slice(0, h.at + 1), v].slice(-limit);
  return { entries, at: entries.length - 1 };
}

/**
 * The nearest entry in direction `dir` that `resolve` can show (null skips it), stored as
 * resolved; null when there is none.
 */
export function step(
  h: History,
  dir: -1 | 1,
  resolve: (v: Visit) => Visit | null,
): { history: History; visit: Visit } | null {
  for (let i = h.at + dir; i >= 0 && i < h.entries.length; i += dir) {
    const v = resolve(h.entries[i]);
    if (v)
      return { history: { entries: h.entries.map((e, j) => (j === i ? v : e)), at: i }, visit: v };
  }
  return null;
}

/**
 * What a visit shows now: the folder while its root keeps that tree, the root of the new tree
 * after a rescan or a reopen; null for a closed root or for what `shown` already shows.
 */
export function restore(
  v: Visit,
  entries: readonly RootEntry[],
  shown: Selection | null,
): Visit | null {
  const entry = entries.find((e) => e.root === v.root);
  if (!entry) return null;
  const generation = entry.summary?.generation ?? null;
  const target = generation === v.generation ? v : { root: v.root, generation, folder: ROOT_ID };
  return shown && same(toVisit(shown), target) ? null : target;
}

import type { TrashPreview, TrashProgress } from "../../api/types";

/** The request as confirmed: its tree and root, the items asked for and their preview. */
export interface TrashRun {
  generation: number;
  root: string;
  ids: readonly number[];
  preview: TrashPreview;
  /** The items are deleted for good, not moved to the trash. */
  purge: boolean;
  /** A request of duplicates: the items of its other trees (one request, one progress). */
  more?: readonly { generation: number; root: string; ids: readonly number[] }[];
}

/** A removal request the user sees: its number, its progress and whether Stop was pressed. */
export interface Run extends TrashRun {
  request: number;
  /** Null until the backend starts it: it waits in the queue of its volume. */
  progress: TrashProgress | null;
  /** Stop was pressed: the request ends after the item that moves now. */
  stopping: boolean;
}

/** How a row goes now: waits for its turn, to the trash, or for good. */
export type RemovingState = "queued" | "trash" | "purge";

// The items of a run as a set, built once per run: its rows ask for each of them on every paint.
const itemSets = new WeakMap<readonly number[], ReadonlySet<number>>();
function inSet(ids: readonly number[], id: number): boolean {
  let set = itemSets.get(ids);
  if (!set) itemSets.set(ids, (set = new Set(ids)));
  return set.has(id);
}

/** Whether `run` removes the item `id` of the tree with `generation`, in any of its trees. */
const hasItem = (run: Run, generation: number, id: number) =>
  (run.generation === generation && inSet(run.ids, id)) ||
  (run.more?.some((m) => m.generation === generation && inSet(m.ids, id)) ?? false);

/** `runs` with the progress `p` set on the run it belongs to; an event of no known run changes nothing. */
export function applyProgress(runs: readonly Run[], p: TrashProgress): readonly Run[] {
  if (!runs.some((r) => r.request === p.request)) return runs;
  return runs.map((r) => (r.request === p.request ? { ...r, progress: p } : r));
}

/** How the item `id` of the tree with `generation` goes now, if a run removes it (a started run wins over a waiting one). */
export function removingState(
  runs: readonly Run[],
  generation: number,
  id: number,
): RemovingState | undefined {
  let state: RemovingState | undefined;
  for (const run of runs) {
    if (!hasItem(run, generation, id)) continue;
    if (run.progress === null) state ??= "queued";
    else return run.purge ? "purge" : "trash";
  }
  return state;
}

/** Whether a run of the tree with `generation` removes any of `ids`, started or waiting. */
export const isRemoving = (runs: readonly Run[], generation: number, ids: readonly number[]) =>
  runs.some((run) => ids.some((id) => hasItem(run, generation, id)));

/** The runs that started, the first `max` of them, and how many more there are; waiting ones are not shown. */
export function shownRuns(runs: readonly Run[], max = 2): { shown: Run[]; more: number } {
  const started = runs.filter((r) => r.progress !== null);
  return { shown: started.slice(0, max), more: Math.max(0, started.length - max) };
}

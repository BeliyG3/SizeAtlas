import type { DupGroup, DupStatus, Duplicates } from "../../api/duplicates";

/** The result as the UI holds it: the groups by key, read by cursor (`job`, `version`). */
export interface DupState {
  job: number;
  version: number;
  groups: ReadonlyMap<string, DupGroup>;
  /** The last answer taken: its flags, counts and roots. */
  answer: Duplicates;
}

/**
 * `state` with `answer` taken in: a whole result replaces the groups, a change adds, replaces and
 * removes them. An answer of an older job changes nothing; a late change of this job (its version
 * not newer) leaves the groups as they are but still brings the stale mark.
 */
export function applyAnswer(state: DupState | null, answer: Duplicates): DupState {
  if (state && answer.job < state.job) return state;
  const sameJob = state !== null && answer.job === state.job;
  if (sameJob && !answer.full && answer.version <= state.version)
    return { ...state, answer: { ...state.answer, stale: answer.stale } };
  const groups = new Map(sameJob && !answer.full ? state.groups : []);
  for (const key of answer.removed) groups.delete(key);
  for (const group of answer.groups) groups.set(group.key, group);
  return { job: answer.job, version: answer.version, groups, answer };
}

/** Whether `status` says there is more to read than `state` holds. */
export function shouldFetch(state: DupState | null, status: DupStatus): boolean {
  if (!state) return true;
  if (status.job !== state.job) return status.job > state.job;
  return status.version > state.version;
}

/** What can be freed, the larger first; equal ones by key, so the order holds between answers. */
export const sortGroups = (groups: Iterable<DupGroup>): DupGroup[] =>
  [...groups].sort((a, b) => b.free - a.free || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

export const totalFree = (groups: Iterable<DupGroup>): number => {
  let sum = 0;
  for (const group of groups) sum += group.free;
  return sum;
};

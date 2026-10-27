import type { DupEstimate, DupStatus } from "../../api/duplicates";
import type { DupState } from "./groups";

interface Shown {
  /** Null while the first estimate is on its way. */
  estimate: DupEstimate | null;
  state: DupState | null;
  status: DupStatus | null;
}

/**
 * The text that stands in for the groups when there are none, or null: groups to show, a search
 * running, or none yet (the header then offers Find with what it would compare).
 */
export function emptyKey({ estimate, state, status }: Shown): string | null {
  if (estimate && estimate.roots === 0 && estimate.skipped.length === 0) return "dup.noRoots";
  if (state && state.groups.size > 0) return null;
  if (estimate && estimate.seeded === 0 && estimate.eligible > 0) return "dup.excluded";
  const job = state?.job ?? 0;
  const running = status?.running ?? state?.answer.running ?? false;
  if (job === 0 || running) return null;
  return state?.answer.complete ? "dup.notFound" : "dup.cancelled";
}

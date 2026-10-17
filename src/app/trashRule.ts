import type { Roots } from "../api/types";

/** A job runs: only then can a scan keep items from the trash, so only then is the backend asked. */
export const jobRuns = (roots: Roots): boolean => roots.queue.some((q) => q.state === "scanning");

/** "Move to the trash" for some items: available, or not, with the reason for its tooltip. */
export interface TrashAvailability {
  enabled: boolean;
  /** Set when a scan still lists one of the items. */
  reason: "scanning" | null;
}

/**
 * Whether items can go to the trash now. Another trash request blocks it; while a job runs, the
 * backend says whether the scan still lists one of them (`refused`, undefined while asked): a
 * first scan's unfinished folders and a refreshed folder are refused, the rest may go.
 */
export function trashAvailability(
  trashing: boolean,
  jobRunning: boolean,
  refused: boolean | undefined,
): TrashAvailability {
  if (trashing) return { enabled: false, reason: null };
  if (!jobRunning) return { enabled: true, reason: null };
  return { enabled: refused === false, reason: refused === true ? "scanning" : null };
}

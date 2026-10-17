import type { QueueEntry, Roots } from "../api/types";

/** The running job: only while one runs can a scan keep items from the trash (the backend says). */
export const runningJob = (roots: Roots): QueueEntry | null =>
  roots.queue.find((q) => q.state === "scanning") ?? null;

/** "Move to the trash" for some items: available, or not, with the reason for its tooltip. */
export interface TrashAvailability {
  enabled: boolean;
  /** Set when a scan still lists one of the items. */
  reason: "scanning" | null;
}

/**
 * Whether items can go to the trash now. Another trash request blocks it; while a job runs, the
 * backend says whether the scan still lists one of them (`refused`, undefined until it first
 * answers): a first scan's unfinished folders and a refreshed folder are refused, the rest may go.
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

/** The text that says why `count` items cannot go; `isDir` of one item when it is known. */
export function trashNoteKey(count: number, isDir?: boolean): string {
  if (count > 1) return "trash.scanningItems";
  if (isDir === undefined) return "trash.scanningItem";
  return isDir ? "trash.scanningFolder" : "trash.scanningFile";
}

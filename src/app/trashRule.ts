import type { QueueEntry, Roots } from "../api/types";

/** The running job: only while one runs can a scan keep items from the trash (the backend says). */
export const runningJob = (roots: Roots): QueueEntry | null =>
  roots.queue.find((q) => q.state === "scanning") ?? null;

/** "Move to the trash" for some items: available, or not, with the reason for its tooltip. */
export interface TrashAvailability {
  enabled: boolean;
  /** Set when a scan still lists one of the items, or a trash request already has one of them. */
  reason: "scanning" | "removing" | null;
}

/**
 * Whether items can go to the trash now. `removing`: a trash request already has one of them,
 * started or waiting (other requests do not matter: they queue). While a job runs, the
 * backend says whether the scan still lists one of them (`refused`, undefined until it first
 * answers): a first scan's unfinished folders and a refreshed folder are refused, the rest may go.
 */
export function trashAvailability(
  removing: boolean,
  jobRunning: boolean,
  refused: boolean | undefined,
): TrashAvailability {
  if (removing) return { enabled: false, reason: "removing" };
  if (!jobRunning) return { enabled: true, reason: null };
  return { enabled: refused === false, reason: refused === true ? "scanning" : null };
}

/** The text that says why `count` items cannot go now, if they cannot; `isDir` of one item when it is known. */
export function availabilityNoteKey(
  available: TrashAvailability,
  count: number,
  isDir?: boolean,
): string | null {
  if (available.reason === "removing") return "trash.already";
  return available.reason ? trashNoteKey(count, isDir) : null;
}

/** The text that says why `count` items a scan still lists cannot go; `isDir` of one item when it is known. */
export function trashNoteKey(count: number, isDir?: boolean): string {
  if (count > 1) return "trash.scanningItems";
  if (isDir === undefined) return "trash.scanningItem";
  return isDir ? "trash.scanningFolder" : "trash.scanningFile";
}

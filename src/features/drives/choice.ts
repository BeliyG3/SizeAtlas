import type { CachedScan, RootStatus } from "../../api/types";

/** A drive in the folder tree, as far as the drives list needs it. */
export interface DriveRoot {
  status: RootStatus;
  /** Null until its first scan or saved scan is open. */
  summary: { scannedAt: number } | null;
}

/**
 * What opening a drive in the list asks: "scan" it (no saved scan of this version and not
 * open), "open" or rescan the scan from `scannedAt` (Unix seconds), or nothing — "select" its
 * root, whose scan runs or waits.
 */
export type DriveChoice =
  { kind: "scan" } | { kind: "open"; scannedAt: number } | { kind: "select" };

export function driveChoice(
  root: DriveRoot | undefined,
  saved: CachedScan | undefined,
): DriveChoice {
  if (root && root.status !== "open") return { kind: "select" };
  if (root?.summary) return { kind: "open", scannedAt: root.summary.scannedAt };
  if (saved && !saved.outdated) return { kind: "open", scannedAt: saved.scannedAt };
  return { kind: "scan" };
}

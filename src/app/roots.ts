import type { RootStatus, Roots, Summary } from "../api/types";

/** The open roots, in the order of the folder tree, reopened at the next start. */
export const ROOTS_KEY = "sizeatlas.roots";
/** The selected root; before M1d, the only root that was reopened. */
export const LAST_ROOT_KEY = "sizeatlas.lastRoot";

/** One root of the folder tree. */
export interface RootEntry {
  /** Canonical path; names the root everywhere in the UI. */
  root: string;
  /** Null until its first scan or saved scan is open. */
  summary: Summary | null;
  status: RootStatus;
}

/**
 * Open roots in their order, then the roots that wait for their first scan, in queue order.
 * An open root whose rescan runs or waits keeps its place and its tree.
 */
export function rootEntries(roots: Roots): RootEntry[] {
  const status = new Map<string, RootStatus>();
  // The running scan comes first: a root queued again after a cancel still shows as scanning.
  // A folder refresh leaves its root open: it keeps its tree and can be scanned again.
  for (const q of roots.queue) {
    if (q.folder === null && !status.has(q.root)) status.set(q.root, q.state);
  }
  const entries: RootEntry[] = roots.roots.map((summary) => ({
    root: summary.root,
    summary,
    status: status.get(summary.root) ?? "open",
  }));
  const listed = new Set(entries.map((e) => e.root));
  for (const [root, state] of status) {
    if (!listed.has(root)) entries.push({ root, summary: null, status: state });
  }
  return entries;
}

/** Canonical root containment by path components, including drive roots and UNC paths. */
function inside(root: string, parent: string): boolean {
  const normal = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");
  const path = normal(root);
  const base = normal(parent);
  return path === base || path.startsWith(`${base}/`);
}

/** Full scans also block another open root inside their scanned path. */
export function fullScanRoots(roots: Roots): ReadonlySet<string> {
  const scans = roots.queue.filter((q) => q.folder === null);
  return new Set([
    ...scans.map((q) => q.root),
    ...roots.roots.filter((r) => scans.some((q) => inside(r.root, q.root))).map((r) => r.root),
  ]);
}

/** Running jobs block trash; a queued rescan keeps an editable complete tree. */
export const busyRoots = (roots: Roots): ReadonlySet<string> =>
  new Set([
    ...roots.queue.filter((q) => q.state === "scanning").map((q) => q.root),
    ...fullScanRoots({ ...roots, queue: roots.queue.filter((q) => q.state === "scanning") }),
  ]);

/** Running first scans also block actions in roots contained by the scanned path. */
export function firstScanRoots(roots: Roots): ReadonlySet<string> {
  const queue = roots.queue.filter(
    (q) =>
      q.state === "scanning" &&
      q.folder === null &&
      !roots.roots.some((s) => s.root === q.root && !s.scanning),
  );
  return fullScanRoots({ ...roots, queue });
}

/** The open roots to remember; queued scans are not reopened. */
export const storedRoots = (roots: Roots): string =>
  JSON.stringify(roots.roots.filter((s) => !s.scanning).map((s) => s.root));

/** Remembered roots; anything that is not a list of paths gives none. */
export function parseStoredRoots(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((v): v is string => typeof v === "string" && v !== ""))];
  } catch {
    return [];
  }
}

/** Roots to reopen at start: the remembered list, or the one root an older version kept. */
export function rootsToReopen(roots: string | null, lastRoot: string | null): string[] {
  if (roots !== null) return parseStoredRoots(roots);
  return lastRoot ? [lastRoot] : [];
}

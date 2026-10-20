import type { CachedScan, Disk, Sources } from "../../api/types";

/** What the main toolbar button does with the chosen source. */
export type SourceAction = "open" | "scan" | "rescan";

/**
 * What the main toolbar button does with the chosen source: "rescan" for the root of the
 * selected node; "open" for another root in the tree (it gets selected) or a source with a
 * saved scan of this version; "scan" otherwise.
 */
export function sourceAction(
  pending: string | null,
  selectedRoot: string | null,
  inTree: ReadonlySet<string>,
  scans: readonly CachedScan[],
): SourceAction | null {
  if (pending === null) return null;
  if (pending === selectedRoot) return "rescan";
  if (inTree.has(pending)) return "open";
  return scans.some((s) => s.root === pending && !s.outdated) ? "open" : "scan";
}

/** Saved scans of folders; drives are listed separately. */
export function recentFolders(sources: Sources | null): CachedScan[] {
  if (!sources) return [];
  const mounts = new Set(sources.disks.map((d) => d.mount));
  return sources.scans.filter((s) => !mounts.has(s.root));
}

export function savedScan(sources: Sources | null, root: string): CachedScan | undefined {
  return sources?.scans.find((s) => s.root === root);
}

/** `path` if it has a saved scan to forget, outdated ones included; else null. */
export const forgettable = (sources: Sources | null, path: string | null): string | null =>
  path !== null && savedScan(sources, path) !== undefined ? path : null;

/** Name of a scan root in the folder tree: "Label (T:)" for a drive with a label, else the path. */
export function rootLabel(sources: Sources | null, root: string): string {
  const disk = sources?.disks.find((d) => d.mount === root);
  if (!disk?.name) return root;
  return `${disk.name} (${root.replace(/[\\/]+$/, "") || root})`;
}

/** Whether `root` is a whole drive (a mount point) rather than a folder on it. */
export const isDrive = (sources: Sources | null, root: string): boolean =>
  sources?.disks.some((d) => d.mount === root) ?? false;

/** Bytes a scan of `path` should find: the used space when `path` is a drive, else unknown. */
export function expectedBytes(sources: Sources | null, path: string): number | null {
  const disk = sources?.disks.find((d) => d.mount === path);
  return disk ? disk.total - disk.available : null;
}

/** Share of the scan done; undefined shows an indeterminate progress bar. */
export function scanFraction(bytes: number, expected: number | null): number | undefined {
  return expected !== null && expected > 0 ? Math.min(1, bytes / expected) : undefined;
}

/** The translate function of `useT`. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Text of a drive in the source list: "C:\  Label", with a note when it is disconnected. */
export const diskLabel = (d: Disk, t: Translate): string =>
  (d.name ? `${d.mount}  ${d.name}` : d.mount) +
  (d.connected ? "" : ` (${t("drives.disconnected")})`);

/** Text of a recent folder in the source list. */
export const folderLabel = (s: CachedScan, t: Translate): string =>
  s.outdated ? t("toolbar.outdated", { root: s.root }) : s.root;

/** Text the source list shows for `source`: its item's label, else the path itself. */
export function sourceLabel(sources: Sources | null, source: string, t: Translate): string {
  const disk = sources?.disks.find((d) => d.mount === source);
  if (disk) return diskLabel(disk, t);
  const scan = sources?.scans.find((s) => s.root === source);
  return scan ? folderLabel(scan, t) : source;
}

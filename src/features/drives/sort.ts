import type { Disk } from "../../api/types";

/** The drives list sorts by any of its columns. */
export type DriveColumn = "name" | "size" | "used" | "free";

export interface DriveSort {
  key: DriveColumn;
  descending: boolean;
}

export const DRIVE_SORT_KEY = "sizeatlas.drives.sort";

export const DEFAULT_DRIVE_SORT: DriveSort = { key: "name", descending: false };

const KEYS: readonly string[] = ["name", "size", "used", "free"];

export const serializeDriveSort = (sort: DriveSort) =>
  `${sort.key}:${sort.descending ? "desc" : "asc"}`;

/** A stored sort; anything unknown gives the default. */
export function parseDriveSort(raw: string | null): DriveSort {
  const [key, direction] = (raw ?? "").split(":");
  return KEYS.includes(key) && (direction === "asc" || direction === "desc")
    ? { key: key as DriveColumn, descending: direction === "desc" }
    : DEFAULT_DRIVE_SORT;
}

/** A header click: the active column reverses; another starts with the largest (names: A to Z). */
export function nextDriveSort(current: DriveSort, key: DriveColumn): DriveSort {
  return key === current.key
    ? { key, descending: !current.descending }
    : { key, descending: key !== "name" };
}

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const VALUE: Readonly<Record<Exclude<DriveColumn, "name">, (d: Disk) => number>> = {
  size: (d) => d.total,
  used: (d) => d.total - d.available,
  free: (d) => d.available,
};

/**
 * A sorted copy of `disks`; ties go by name. Names compare without regard to case. A
 * disconnected drive has no sizes: it comes last by any size column, whichever the direction.
 */
export function sortDisks(disks: readonly Disk[], sort: DriveSort): Disk[] {
  const names = (a: Disk, b: Disk) => byName.compare(a.mount, b.mount);
  const key = sort.key;
  const compare = key === "name" ? names : (a: Disk, b: Disk) => VALUE[key](a) - VALUE[key](b);
  const sign = sort.descending ? -1 : 1;
  const unknown = (a: Disk, b: Disk) => (key === "name" ? 0 : +!a.connected - +!b.connected);
  return [...disks].sort((a, b) => unknown(a, b) || sign * compare(a, b) || names(a, b));
}

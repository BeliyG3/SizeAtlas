import type { CleanupDto, ReasonDto } from "./cleanup";

/** `size` is the size on disk, `len` the logical length. */
export type SortKey = "name" | "size" | "len" | "files" | "dirs" | "modified" | "change";

/** Order of a listing; ties go by name bytes, then by id. */
export interface ListOrder {
  key: SortKey;
  descending: boolean;
  dirsOnly: boolean;
}

export type SizeMode = "Allocated" | "ClusterEstimate" | "Logical";

export type CmdError =
  | {
      code:
        | "StaleId"
        | "Busy"
        | "Changed"
        | "CacheInvalid"
        | "CacheOutdated"
        | "CacheNotSaved"
        | "LossyName"
        | "NoTrash"
        | "Protected"
        | "LastCopy"
        | "Cancelled";
    }
  | { code: "NoAccess"; path: string }
  | { code: "Io"; path: string; osMessage: string };

export interface Volume {
  total: number;
  free: number;
  /** Used space the scan did not find. */
  unaccounted: number;
}

export interface Summary {
  generation: number;
  rev: number;
  rootId: number;
  root: string;
  total: number;
  files: number;
  len: number;
  dirs: number;
  scannedAt: number;
  sizeMode: SizeMode;
  accessErrors: number;
  approximate: boolean;
  /** A first scan's provisional tree. Absent in older snapshots. */
  scanning?: boolean;
  volume: Volume | null;
  /** When the baseline (the previous full scan) was scanned, in seconds; null without one. */
  baselineAt: number | null;
  /** Counts the changes of the baseline, which leave `rev` as it is: refetch rows when it changes. */
  baselineRev: number;
  /** The baseline is being computed: `baselineAt` is null until then, which says nothing yet. */
  baselinePending: boolean;
}

/** Id of the root node in every tree (`Summary.rootId`). */
export const ROOT_ID = 0;

export interface Item {
  id: number;
  name: string;
  /** Size on disk; for folders, of the whole subtree. */
  size: number;
  /** Logical length; for folders, of the whole subtree. */
  len: number;
  files: number;
  /** Folders at any depth below this one. */
  dirs: number;
  /** Folders directly inside this one. */
  folders: number;
  /** Milliseconds since the Unix epoch; 0 if unknown. */
  modified: number;
  isDir: boolean;
  category: number;
  accessError: boolean;
  cloud: boolean;
  lossy: boolean;
  pending?: boolean;
  scanning?: boolean;
  /** Size on disk in the baseline; null without a baseline and for new items. */
  before: number | null;
  /** Change of the size on disk since the baseline; null without a baseline. */
  change: Change | null;
  /** The delta is approximate: something below was unreadable in one scan, or a scan was approximate. */
  approxChange: boolean;
}

/** Bytes gained (negative when lost); "new": not in the baseline; "unknown": readable in only one scan. */
export type Change = { delta: number } | "new" | "unknown";

export interface ChildrenPage {
  generation: number;
  rev: number;
  approximate: boolean;
  /** Size on disk of the listed folder itself. */
  size: number;
  total: number;
  restCount: number;
  restSize: number;
  items: Item[];
  /** As in `Summary`. */
  baselineAt: number | null;
  baselineRev: number;
  baselinePending: boolean;
}

export interface Crumb {
  id: number;
  name: string;
  size: number;
  /** Position among the parent's subfolders, in the folder tree's order. */
  rank: number;
}

export interface Disk {
  name: string;
  mount: string;
  total: number;
  available: number;
  removable: boolean;
  /** A mapped network drive (Windows). */
  network: boolean;
  /** False for a network drive that does not answer: it has no sizes. */
  connected: boolean;
}

export interface CachedScan {
  root: string;
  scannedAt: number;
  total: number;
  files: number;
  outdated: boolean;
}

export interface Sources {
  disks: Disk[];
  scans: CachedScan[];
}

export interface ScanProgress {
  /** Root of the running scan. */
  root: string;
  files: number;
  dirs: number;
  bytes: number;
  current: string;
}

/** A job in the queue: the running one, or one waiting for it. */
export interface QueueEntry {
  root: string;
  state: "scanning" | "queued";
  /** The folder a refresh scans again; null for a scan of the whole root. */
  folder: string | null;
}

/** A root of the folder tree: open, or its scan runs or waits. */
export type RootStatus = "open" | QueueEntry["state"];

/** Open roots in the order of the folder tree, and the scan queue (the running scan first). */
export interface Roots {
  roots: Summary[];
  queue: QueueEntry[];
}

/** A queued scan failed, or its result could not be saved (`CacheNotSaved`). */
export interface ScanError {
  root: string;
  error: CmdError;
}

export interface TypeStat {
  category: number;
  files: number;
  size: number;
}

export interface TypeStats {
  generation: number;
  rev: number;
  items: TypeStat[];
}

/** A flat list of a subtree (the core's `ListKind`). */
export type ListKind =
  | "largestFiles"
  | "largestFolders"
  | "largest"
  | "oldestFiles"
  | "oldestFolders"
  | "oldest"
  | "newestFiles"
  | "newestFolders"
  | "newest"
  | "emptyFolders"
  | "emptyFiles"
  | "empty"
  | "unreadable"
  | "longestPaths"
  | "grewMost"
  | "cleanup"
  | "review"
  | "search";

export interface ListItem extends Item {
  /** Folder of the item relative to the listed folder; empty if it is directly inside. */
  folder: string;
  /** The folder the item is in. */
  parent: number;
  /** A folder the baseline had and the tree has no more ("grewMost" only); its id is not a node. */
  deleted: boolean;
  /** "cleanup" and "review" only; null in the other lists. */
  reason: ReasonDto | null;
}

export interface List {
  generation: number;
  rev: number;
  /** Size on disk of the listed folder: the base of the percentages. */
  size: number;
  /** More items matched than the limit allowed. */
  truncated: boolean;
  items: ListItem[];
  /** "search", "cleanup" and "review" only: every match, not just the listed ones, and their size on disk without double counting. */
  found: { count: number; size: number } | null;
  /** "cleanup" and "review" only: the facts under the total. */
  cleanup: CleanupDto | null;
  /** As in `Summary`. */
  baselineAt: number | null;
  baselineRev: number;
  baselinePending: boolean;
}

/** Details of one row read from disk; `null` fields are not available. Times in milliseconds. */
export interface Detail {
  id: number;
  created: number | null;
  accessed: number | null;
  attributes: string | null;
  owner: string | null;
}

export interface Details {
  generation: number;
  items: Detail[];
}

/** What a trash request would move, for its confirmation. */
export interface TrashPreview {
  /** Items that would go, without those inside another one. */
  count: number;
  /** Size on disk of all of them. */
  size: number;
  /** Seconds since the Unix epoch. */
  scannedAt: number;
  /** Full paths of the first few. */
  paths: string[];
  /** Bytes the Recycle Bin of the root's drive can still take before it drops old files; null where unknown. */
  binFree: number | null;
  /** What the Recycle Bin counts for the items: per item the larger of the size on disk and the length. */
  binSize: number;
}

/** What a trash request did. */
export interface TrashResult {
  removed: number;
  /** Items that stayed: `NoTrash`, `Changed`, `NoAccess` or `Io` with the message of the system. */
  failed: { path: string; error: CmdError }[];
  /** `CacheNotSaved` when the change could not be saved. */
  warning: CmdError | null;
  /** Stopped by `cancelTrash` before every item was tried: the rest stayed where it was. */
  stopped: boolean;
  /** Items that were gone from the disk already (an earlier request took them, or someone else): no error. */
  gone: number;
  /** Size on disk of the items that moved. */
  size: number;
  /** Never started (Stop of its volume, or the app closed, while it waited): nothing was tried. */
  cancelled: boolean;
}

/** How far a trash request got: `done` of `total` items were tried; `current` goes next (null once it ended). */
export interface TrashProgress {
  /** The request it is of, as given to `trash` or `deleteForGood`. */
  request: number;
  done: number;
  total: number;
  current: string | null;
  /** While a trash of duplicates reads the copy that stays (`current`) again: bytes read, of its length. */
  rehash?: [number, number];
}

/** An island of the archipelago, moved by `(x, z)` metres. */
export interface ArchipelagoIsland {
  generation: number;
  /** The `rev` of the island in the header of its `getCity` bytes: the offsets and gate nodes fit them only while the two are equal. */
  rev: number;
  /** The `build` of the island in the header of its `getCity` bytes: a rebuild for other neighbours has other gates under the same `rev`, so the bytes fit the bridges only while the two are equal. */
  build: number;
  root: string;
  x: number;
  z: number;
}

/** A bridge between two gates; each end is `[index in islands, gate node]`, `points` run from `a` to `b` in world metres; `levels[k]` is the deck of the run from `points[k]` to `points[k + 1]`. */
export interface ArchipelagoBridge {
  a: [number, number];
  b: [number, number];
  points: [number, number][];
  levels: number[];
}

/** The open drives in the order of their size on disk, with their bridges; a root that is no drive lies alone. */
export interface Archipelago {
  islands: ArchipelagoIsland[];
  bridges: ArchipelagoBridge[];
}

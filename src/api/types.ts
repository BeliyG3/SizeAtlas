/** `size` is the size on disk, `len` the logical length. */
export type SortKey = "name" | "size" | "len" | "files" | "dirs" | "modified";

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
}

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
  | "longestPaths";

export interface ListItem extends Item {
  /** Folder of the item relative to the listed folder; empty if it is directly inside. */
  folder: string;
  /** The folder the item is in. */
  parent: number;
}

export interface List {
  generation: number;
  rev: number;
  /** Size on disk of the listed folder: the base of the percentages. */
  size: number;
  /** More items matched than the limit allowed. */
  truncated: boolean;
  items: ListItem[];
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
}

/** How far a trash request got: `done` of `total` items were tried; `current` goes next (null once it ended). */
export interface TrashProgress {
  done: number;
  total: number;
  current: string | null;
}

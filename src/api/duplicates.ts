// The duplicate search: mirrors of the DTOs in `src-tauri/src/dto/duplicates.rs`.

/** Starts and ends of files (counted in files), or whole files (counted in bytes). */
export type DupPhase = "prefix" | "full";

/** Where a search job is; the payload of the `duplicates-status` event. */
export interface DupStatus {
  job: number;
  /** The version of the result when this was sent. */
  version: number;
  running: boolean;
  /** The result is out of date: search again before removing. */
  stale: boolean;
  /** Null before the first progress. */
  phase: DupPhase | null;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

/** One path of a copy: node `id` of the tree of `root` with `generation`. */
export interface DupRef {
  root: string;
  generation: number;
  id: number;
}

/** One file of a group: every found path of it (hard links), shown by its first. */
export interface DupCopy {
  refs: DupRef[];
  path: string;
  root: string;
  /** Milliseconds since the Unix epoch; 0 when unknown. */
  mtime: number;
  size: number;
  /** Lies in a zone: never removed here. */
  protected: boolean;
  /** Has links outside the found paths: removing it frees nothing. */
  hardlink: boolean;
  /** Lies in a cloud sync folder. */
  synced: boolean;
  /** Its file id could not be told: neither kept nor removed. */
  noId: boolean;
  trashable: boolean;
  /** Its first path lies on a spinning disk: a thumbnail reads another copy if it can. */
  hdd: boolean;
}

/** Files of equal content. */
export interface DupGroup {
  /** The whole-file hash, in hex. */
  key: string;
  len: number;
  /** The size on disk of a copy (the largest). */
  size: number;
  /** At most what removing copies frees. */
  free: number;
  /** The file name of one of the copies. */
  name: string;
  /** File category (see `ItemIcon`). */
  category: number;
  stale: boolean;
  copies: DupCopy[];
}

/** Files left out, by why. */
export interface DupUnread {
  cloud: number;
  changed: number;
  noAccess: number;
  failed: number;
}

/** What changed in the result after the cursor the UI gave (all of it when `full`). */
export interface Duplicates {
  /** 0 without a result. */
  job: number;
  version: number;
  running: boolean;
  /** Not cancelled. */
  complete: boolean;
  /** A searched root changed, closed, or another one opened: search again before removing. */
  stale: boolean;
  /** `groups` is the whole result, not a change. */
  full: boolean;
  query: string;
  system: boolean;
  groups: DupGroup[];
  /** Keys of groups gone. */
  removed: string[];
  unread: DupUnread;
  /** Roots left out: they were being scanned. */
  skipped: string[];
  status: DupStatus;
}

/** What a search would compare, before it starts. */
export interface DupEstimate {
  /** Candidates whose length another candidate shares, in groups with a seed. */
  files: number;
  /** Their summed lengths. */
  bytes: number;
  /** Files of at least 4 KB before the excluded folders and the search filters. */
  eligible: number;
  /** Files the search filters pick (seeds), before grouping by length. */
  seeded: number;
  roots: number;
  skipped: string[];
}

// Answers of the duplicates backend for the tests of this feature.
import type { DupCopy, DupEstimate, DupGroup, DupStatus, Duplicates } from "../../api/duplicates";

export const copy = (id: number, more: Partial<DupCopy> = {}): DupCopy => ({
  refs: [{ root: "C:\\", generation: 1, id }],
  path: `C:\\f${id}.jpg`,
  root: "C:\\",
  mtime: 0,
  size: 4096,
  protected: false,
  hardlink: false,
  synced: false,
  noId: false,
  trashable: true,
  hdd: false,
  ...more,
});

export const group = (key: string, free = 4096, more: Partial<DupGroup> = {}): DupGroup => ({
  key,
  len: 4096,
  size: 4096,
  free,
  name: `${key}.jpg`,
  category: 0,
  stale: false,
  copies: [copy(1), copy(2)],
  ...more,
});

export const status = (more: Partial<DupStatus> = {}): DupStatus => ({
  job: 0,
  version: 0,
  running: false,
  stale: false,
  phase: null,
  filesDone: 0,
  filesTotal: 0,
  bytesDone: 0,
  bytesTotal: 0,
  ...more,
});

export const answer = (more: Partial<Duplicates> = {}): Duplicates => {
  const base: Duplicates = {
    job: 0,
    version: 0,
    running: false,
    complete: false,
    stale: false,
    full: true,
    query: "type:image",
    system: false,
    groups: [],
    removed: [],
    unread: { cloud: 0, changed: 0, noAccess: 0, failed: 0 },
    skipped: [],
    status: status(),
    ...more,
  };
  const { job, version, running, stale } = base;
  return { ...base, status: { ...base.status, job, version, running, stale } };
};

export const estimate = (more: Partial<DupEstimate> = {}): DupEstimate => ({
  files: 10,
  bytes: 40960,
  eligible: 20,
  seeded: 5,
  roots: 1,
  skipped: [],
  ...more,
});

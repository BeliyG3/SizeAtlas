import { describe, expect, it } from "vitest";
import type { Change, ListItem } from "../../api/types";
import {
  defaultListSort,
  emptyListKey,
  liveId,
  nextListSort,
  menuCleanup,
  sortRows,
  staleScan,
} from "./rows";

const item = (id: number, name: string, folder: string, size: number): ListItem => ({
  id,
  name,
  folder,
  parent: 0,
  size,
  len: size,
  files: 0,
  dirs: 0,
  folders: 0,
  modified: id,
  isDir: false,
  category: 0,
  accessError: false,
  cloud: false,
  lossy: false,
  deleted: false,
  reason: null,
  before: null,
  change: null,
  approxChange: false,
});

const list = [item(1, "b", "x", 5), item(2, "a", "y", 9), item(3, "c", "x", 5)];
const ids = (rows: readonly ListItem[]) => rows.map((r) => r.id);

describe("list rows", () => {
  it("keep the list's own order until a header is clicked", () => {
    expect(sortRows(list, null)).toBe(list);
  });

  it("sort by a column and keep the list's order between equal items", () => {
    expect(ids(sortRows(list, { column: "size", descending: true }))).toEqual([2, 1, 3]);
    expect(ids(sortRows(list, { column: "percent", descending: false }))).toEqual([1, 3, 2]);
    expect(ids(sortRows(list, { column: "name", descending: false }))).toEqual([2, 1, 3]);
    expect(ids(sortRows(list, { column: "path", descending: false }))).toEqual([1, 3, 2]);
    expect(ids(sortRows(list, { column: "path", descending: true }))).toEqual([2, 3, 1]);
    expect(ids(sortRows(list, { column: "owner", descending: true }))).toEqual([1, 2, 3]);
  });

  it("sort by change: a new item grows by its size, no change is 0, unknown goes last", () => {
    const changed = (id: number, size: number, change: Change | null) => ({
      ...item(id, String(id), "", size),
      change,
    });
    const rows = [
      changed(1, 50, { delta: -20 }),
      changed(2, 30, "unknown"),
      changed(3, 40, "new"),
      changed(4, 70, { delta: 100 }),
      changed(5, 10, null),
    ];
    expect(ids(sortRows(rows, { column: "change", descending: true }))).toEqual([4, 3, 5, 1, 2]);
    expect(ids(sortRows(rows, { column: "change", descending: false }))).toEqual([1, 5, 3, 4, 2]);
  });

  it("sort by the size before, a new item counting as 0", () => {
    const rows = [
      { ...item(1, "a", "", 0), before: 5 },
      { ...item(2, "b", "", 0), before: null },
      { ...item(3, "c", "", 0), before: 9 },
    ];
    expect(ids(sortRows(rows, { column: "before", descending: true }))).toEqual([3, 1, 2]);
  });

  it("sort names naturally, ignoring case", () => {
    const files = [item(1, "file10", "", 0), item(2, "File2", "", 0)];
    expect(ids(sortRows(files, { column: "name", descending: false }))).toEqual([2, 1]);
  });

  it("flip the same column; start names and paths ascending, the rest descending", () => {
    expect(nextListSort(null, "size")).toEqual({ column: "size", descending: true });
    expect(nextListSort(null, "path")).toEqual({ column: "path", descending: false });
    expect(nextListSort({ column: "name", descending: false }, "name")).toEqual({
      column: "name",
      descending: true,
    });
    expect(nextListSort({ column: "name", descending: true }, "modified")).toEqual({
      column: "modified",
      descending: true,
    });
  });

  it("start Grew most sorted by the change, the largest growth first; other lists as they came", () => {
    expect(defaultListSort("grewMost")).toEqual({ column: "change", descending: true });
    expect(defaultListSort("largest")).toBeNull();
  });

  it("give no id of a deleted folder to what reaches the tree: it is not a node", () => {
    const gone = { ...item(4294967295, "gone", "x", 0), deleted: true };
    expect(liveId(gone)).toBeUndefined();
    expect(liveId(list[0])).toBe(1);
    expect(liveId(undefined)).toBeUndefined();
  });
});

describe("a list without rows", () => {
  const list = (baselineAt: number | null, baselinePending: boolean) => ({
    baselineAt,
    baselinePending,
  });

  it("says why grew most is empty: no previous scan, or the comparison still running", () => {
    expect(emptyListKey("grewMost", list(null, false))).toBe("lists.noBaseline");
    expect(emptyListKey("grewMost", list(null, true))).toBe("lists.baselinePending");
    expect(emptyListKey("grewMost", list(5, false))).toBe("lists.empty");
    expect(emptyListKey("largestFiles", list(null, true))).toBe("lists.empty");
  });

  it("says there is nothing to clean in the two clean-up lists, whatever the baseline", () => {
    expect(emptyListKey("cleanup", list(null, false))).toBe("cleanup.none");
    expect(emptyListKey("review", list(5, true))).toBe("cleanup.none");
  });

  it("says nothing was found for a search, whatever the baseline", () => {
    expect(emptyListKey("search", list(null, false))).toBe("search.none");
    expect(emptyListKey("search", list(5, false))).toBe("search.none");
  });
});

describe("a stale scan", () => {
  const DAY = 24 * 60 * 60;
  const now = 1_000 * DAY * 1000;
  const at = (ago: number) => 1_000 * DAY - ago;

  it("is one made more than a day ago", () => {
    expect(staleScan(at(DAY - 1), now)).toBe(false);
    expect(staleScan(at(DAY + 1), now)).toBe(true);
    expect(staleScan(at(30 * DAY), now)).toBe(true);
  });

  it("is not one with an unknown time or in the future", () => {
    expect(staleScan(0, now)).toBe(false);
    expect(staleScan(at(-5 * DAY), now)).toBe(false);
  });
});

describe("the menu of a clean-up row", () => {
  const row = (command: string | null): ListItem => ({
    ...list[0],
    reason: { reason: "packageCache", command, restorable: null },
  });

  it("knows it comes from a clean-up list, and the command of its tool", () => {
    expect(menuCleanup(row("npm cache clean --force"), "cleanup")).toEqual({
      cleanup: true,
      command: "npm cache clean --force",
    });
    expect(menuCleanup(row(null), "review")).toEqual({ cleanup: true });
  });

  it("knows nothing about the rows of other lists, whatever they carry", () => {
    expect(menuCleanup(row("npm cache clean --force"), "largest")).toEqual({});
    expect(menuCleanup(row("x"), "search")).toEqual({});
    expect(menuCleanup(list[0], "cleanup")).toEqual({ cleanup: true });
  });
});

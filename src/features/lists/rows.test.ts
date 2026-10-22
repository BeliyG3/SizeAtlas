import { describe, expect, it } from "vitest";
import type { Change, ListItem } from "../../api/types";
import { nextListSort, sortRows } from "./rows";

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
});

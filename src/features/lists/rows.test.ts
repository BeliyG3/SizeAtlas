import { describe, expect, it } from "vitest";
import type { ListItem } from "../../api/types";
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

import { describe, expect, it } from "vitest";
import {
  COPY_GRID,
  DEFAULT_COPY_SORT,
  DEFAULT_GROUP_SORT,
  GROUP_GRID,
  copyOrder,
  nextDupSort,
  parseDupSort,
  serializeDupSort,
  sortGroups,
} from "./columns";
import { copy, group } from "./dup.testSupport";

describe("the columns of the duplicates tables", () => {
  it("keep the name and the path first", () => {
    expect(GROUP_GRID.columns.map((c) => c.id)).toEqual(["name", "copies", "size", "free"]);
    expect(GROUP_GRID.pinned).toBe("name");
    expect(COPY_GRID.columns.map((c) => c.id)).toEqual(["path", "modified", "root", "marks"]);
    expect(COPY_GRID.pinned).toBe("path");
    expect(COPY_GRID.labelKey("marks")).toBe("dup.colMarks");
  });

  it("sort groups by what can be freed by default, the larger first, then by key", () => {
    expect(DEFAULT_GROUP_SORT).toEqual({ column: "free", descending: true });
    const sorted = sortGroups([group("b", 10), group("c", 30), group("a", 30)], DEFAULT_GROUP_SORT);
    expect(sorted.map((g) => g.key)).toEqual(["a", "c", "b"]);
  });

  it("sort groups by name, copies or size, either way", () => {
    const few = group("x", 1, { name: "b.png", size: 50 });
    const many = group("y", 1, { name: "A.png", size: 10, copies: [copy(1), copy(2), copy(3)] });
    const keys = (column: "name" | "copies" | "size", descending: boolean) =>
      sortGroups([few, many], { column, descending }).map((g) => g.key);
    expect(keys("name", false)).toEqual(["y", "x"]);
    expect(keys("name", true)).toEqual(["x", "y"]);
    expect(keys("copies", true)).toEqual(["y", "x"]);
    expect(keys("size", true)).toEqual(["x", "y"]);
    expect(keys("size", false)).toEqual(["y", "x"]);
  });

  it("put groups of equal copies by what can be freed, the larger first", () => {
    const small = group("a", 10);
    const large = group("b", 99);
    const sorted = sortGroups([small, large], { column: "copies", descending: false });
    expect(sorted.map((g) => g.key)).toEqual(["b", "a"]);
  });

  it("order copies by path by default, or by date or root, keeping their indices", () => {
    expect(DEFAULT_COPY_SORT).toEqual({ column: "path", descending: false });
    const copies = [
      copy(1, { path: "D:\\b.png", root: "D:\\", mtime: 300 }),
      copy(2, { path: "C:\\c.png", root: "C:\\", mtime: 100 }),
      copy(3, { path: "C:\\a.png", root: "C:\\", mtime: 200 }),
    ];
    expect(copyOrder(copies, DEFAULT_COPY_SORT)).toEqual([2, 1, 0]);
    expect(copyOrder(copies, { column: "modified", descending: true })).toEqual([0, 2, 1]);
    // Equal roots go by path.
    expect(copyOrder(copies, { column: "root", descending: false })).toEqual([2, 1, 0]);
  });

  it("start a new column with the largest number or the first name, flip the same one", () => {
    expect(nextDupSort(DEFAULT_GROUP_SORT, "free")).toEqual({ column: "free", descending: false });
    expect(nextDupSort(DEFAULT_GROUP_SORT, "copies")).toEqual({
      column: "copies",
      descending: true,
    });
    expect(nextDupSort(DEFAULT_GROUP_SORT, "name")).toEqual({ column: "name", descending: false });
    expect(nextDupSort(DEFAULT_COPY_SORT, "modified")).toEqual({
      column: "modified",
      descending: true,
    });
    expect(nextDupSort(DEFAULT_COPY_SORT, "root")).toEqual({ column: "root", descending: false });
  });

  it("store a sort and read back only a known one", () => {
    const columns = ["name", "free"] as const;
    const sort = { column: "name" as const, descending: true };
    expect(parseDupSort(serializeDupSort(sort), columns, DEFAULT_GROUP_SORT)).toEqual(sort);
    expect(parseDupSort("marks:asc", columns, DEFAULT_GROUP_SORT)).toBe(DEFAULT_GROUP_SORT);
    expect(parseDupSort("name:up", columns, DEFAULT_GROUP_SORT)).toBe(DEFAULT_GROUP_SORT);
    expect(parseDupSort(null, columns, DEFAULT_GROUP_SORT)).toBe(DEFAULT_GROUP_SORT);
  });
});

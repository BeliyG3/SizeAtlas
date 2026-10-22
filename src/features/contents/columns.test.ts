import { describe, expect, it } from "vitest";
import { COLUMNS, DEFAULT_SORT, nextSort, type ColumnId } from "./columns";

const column = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!;

describe("columns", () => {
  it("sort exactly the columns of the design", () => {
    expect(COLUMNS.filter((c) => c.sortKey !== null).map((c) => c.id)).toEqual([
      "name",
      "len",
      "size",
      "percent",
      "change",
      "files",
      "dirs",
      "modified",
    ]);
  });

  it("flip the direction on the same column and start a new one descending", () => {
    expect(nextSort(DEFAULT_SORT, column("size"))).toEqual({ ...DEFAULT_SORT, descending: false });
    expect(nextSort(DEFAULT_SORT, column("name"))).toEqual({
      column: "name",
      key: "name",
      descending: false,
    });
    expect(nextSort(DEFAULT_SORT, column("modified"))).toEqual({
      column: "modified",
      key: "modified",
      descending: true,
    });
    expect(nextSort(DEFAULT_SORT, column("percent"))).toEqual({
      column: "percent",
      key: "size",
      descending: true,
    });
    expect(nextSort(DEFAULT_SORT, column("owner"))).toBe(DEFAULT_SORT);
  });

  it("have the Path and Before columns in the flat lists only", () => {
    expect(COLUMNS.filter((c) => c.listOnly).map((c) => c.id)).toEqual(["path", "before"]);
  });
});

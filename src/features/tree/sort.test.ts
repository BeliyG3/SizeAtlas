import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_SORT,
  nextTreeSort,
  parseTreeSort,
  serializeTreeSort,
  treeOrder,
} from "./sort";

describe("parseTreeSort", () => {
  it("reads every stored combination", () => {
    for (const key of ["name", "size"] as const) {
      for (const descending of [false, true]) {
        const sort = { key, descending };
        expect(parseTreeSort(serializeTreeSort(sort))).toEqual(sort);
      }
    }
  });

  it("falls back to name ascending for anything unknown", () => {
    for (const raw of [null, "", "size", "len:asc", "name:up", "{}", "SIZE:DESC"]) {
      expect(parseTreeSort(raw)).toEqual(DEFAULT_TREE_SORT);
    }
    expect(DEFAULT_TREE_SORT).toEqual({ key: "name", descending: false });
  });
});

describe("nextTreeSort", () => {
  it("reverses the active column", () => {
    expect(nextTreeSort({ key: "name", descending: false }, "name")).toEqual({
      key: "name",
      descending: true,
    });
    expect(nextTreeSort({ key: "size", descending: true }, "size")).toEqual({
      key: "size",
      descending: false,
    });
  });

  it("starts another column in its natural direction", () => {
    expect(nextTreeSort({ key: "name", descending: true }, "size")).toEqual({
      key: "size",
      descending: true,
    });
    expect(nextTreeSort({ key: "size", descending: false }, "name")).toEqual({
      key: "name",
      descending: false,
    });
  });
});

describe("treeOrder", () => {
  it("lists folders only", () => {
    expect(treeOrder({ key: "size", descending: true })).toEqual({
      key: "size",
      descending: true,
      dirsOnly: true,
    });
  });
});

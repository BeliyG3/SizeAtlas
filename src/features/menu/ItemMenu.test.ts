import { describe, expect, it } from "vitest";
import { menuIds } from "./ItemMenu";

describe("item menu", () => {
  it("acts on the marked rows it opened on, else on its one item", () => {
    expect(menuIds({ id: 1, isDir: false, lossy: false, x: 0, y: 0 })).toEqual([1]);
    expect(menuIds({ id: 1, isDir: false, lossy: false, marked: [1, 2], x: 0, y: 0 })).toEqual([
      1, 2,
    ]);
  });

  it("gives no id of a deleted folder: only its path can be copied", () => {
    const gone = {
      id: 4294967295,
      isDir: true,
      lossy: false,
      deletedPath: "C:\\a\\gone",
      x: 0,
      y: 0,
    };
    expect(menuIds(gone)).toEqual([]);
  });
});

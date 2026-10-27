import { describe, expect, it } from "vitest";
import { defaultView, gridSpec, parseGridView, toggleGridColumn } from "./grid";

type Id = "name" | "a" | "b";
const SPEC = gridSpec<Id>({
  key: "test",
  pinned: "name",
  labelKey: (id) => id,
  columns: [
    { id: "name", width: 200, numeric: false },
    { id: "a", width: 80, numeric: true },
    { id: "b", width: 90, numeric: true },
  ],
});

describe("the columns of a grid table", () => {
  it("have their default widths and every column shown", () => {
    expect(SPEC.defaults).toEqual({ name: 200, a: 80, b: 90 });
    expect(defaultView(SPEC)).toEqual({ order: ["name", "a", "b"], hidden: [] });
  });

  it("read a stored view, keeping the pinned column first and shown", () => {
    const raw = JSON.stringify({ order: ["b", "name", "x"], hidden: ["name", "a", "x"] });
    expect(parseGridView(SPEC, raw)).toEqual({ order: ["name", "b", "a"], hidden: ["a"] });
  });

  it("give the default view for garbage", () => {
    expect(parseGridView(SPEC, "{")).toEqual(defaultView(SPEC));
    expect(parseGridView(SPEC, null)).toEqual(defaultView(SPEC));
    expect(parseGridView(SPEC, "42")).toEqual(defaultView(SPEC));
  });

  it("hide and show a column, never the pinned one", () => {
    const hidden = toggleGridColumn(SPEC, defaultView(SPEC), "a");
    expect(hidden.hidden).toEqual(["a"]);
    expect(toggleGridColumn(SPEC, hidden, "a").hidden).toEqual([]);
    expect(toggleGridColumn(SPEC, hidden, "name")).toBe(hidden);
  });
});

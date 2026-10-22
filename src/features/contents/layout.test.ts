import { describe, expect, it } from "vitest";
import type { ListKind } from "../../api/types";
import { moveColumn as moveAny } from "../columns/order";
import { COLUMNS, DEFAULT_SORT, DEFAULT_WIDTHS, type ColumnId } from "./columns";
import {
  DEFAULT_VIEW,
  comparedByDefault,
  gridTemplate,
  type ColumnView,
  parseView,
  serializeView,
  toggleColumn,
  totalWidth,
  visibleColumns,
  visibleSort,
  withDefaults,
} from "./layout";

const ids = COLUMNS.map((c) => c.id);
/** As the table moves columns: Name pinned first. */
const moveColumn = (order: readonly ColumnId[], id: ColumnId, before: ColumnId | null) =>
  moveAny(order, id, before, "name");

describe("column view", () => {
  it("starts with every column in the default order", () => {
    expect(DEFAULT_VIEW.order).toEqual(ids);
    expect(DEFAULT_VIEW.hidden).toEqual([]);
  });

  it("restores a stored view and falls back to the defaults on garbage", () => {
    for (const raw of [null, "not json", "[]", "7", '{"order": "name"}']) {
      expect(parseView(raw)).toEqual(DEFAULT_VIEW);
    }
    const view = {
      order: ["name", "owner", ...ids.slice(1, -1)],
      hidden: ["files"],
      shown: ["change"],
    };
    expect(parseView(serializeView(view as never))).toEqual(view);
  });

  it("repairs a stored order: known ids once, new columns appended, Name first", () => {
    const view = parseView(
      JSON.stringify({ order: ["size", "ghost", "name", "size", 5], hidden: ["name", "x", "len"] }),
    );
    expect(view.order.slice(0, 2)).toEqual(["name", "size"]);
    expect([...view.order].sort()).toEqual([...ids].sort());
    // Name cannot be hidden; unknown ids are dropped.
    expect(view.hidden).toEqual(["len"]);
  });

  it("keeps a usable field when the other one is broken", () => {
    expect(parseView(JSON.stringify({ order: "x", hidden: ["owner"] }))).toEqual({
      ...DEFAULT_VIEW,
      hidden: ["owner"],
    });
    const order = moveColumn(ids, "owner", "len");
    expect(parseView(JSON.stringify({ order, hidden: 3 }))).toEqual({
      order,
      hidden: [],
      shown: [],
    });
  });

  it("sorts by a shown column: the default, or Name when that is hidden too", () => {
    const modified = { column: "modified", key: "modified", descending: true } as const;
    expect(visibleSort(modified, DEFAULT_VIEW)).toBe(modified);
    expect(visibleSort(modified, { ...DEFAULT_VIEW, hidden: ["modified"] })).toBe(DEFAULT_SORT);
    const byName = visibleSort(DEFAULT_SORT, { ...DEFAULT_VIEW, hidden: ["size"] });
    expect(byName).toEqual({ column: "name", key: "name", descending: false });
    // The same object every time: it feeds memoized orders.
    expect(visibleSort(DEFAULT_SORT, { ...DEFAULT_VIEW, hidden: ["size"] })).toBe(byName);
  });

  it("moves a column before another, or to the end; Name stays first", () => {
    const order: ColumnId[] = ["name", "len", "size", "percent"];
    expect(moveColumn(order, "percent", "len")).toEqual(["name", "percent", "len", "size"]);
    expect(moveColumn(order, "len", null)).toEqual(["name", "size", "percent", "len"]);
    expect(moveColumn(order, "len", "len")).toEqual(order);
    expect(moveColumn(order, "size", "name")).toEqual(["name", "size", "len", "percent"]);
    expect(moveColumn(order, "name", null)).toEqual(order);
  });

  it("hides and shows columns, never Name", () => {
    const hidden = toggleColumn(DEFAULT_VIEW, "owner", true);
    expect(hidden.hidden).toEqual(["owner"]);
    expect(toggleColumn(hidden, "owner", true).hidden).toEqual([]);
    expect(toggleColumn(DEFAULT_VIEW, "name", true)).toBe(DEFAULT_VIEW);
  });

  it("counts a baseline being computed as one: Change keeps its place meanwhile", () => {
    const root = (baselineAt: number | null, baselinePending: boolean) => ({
      baselineAt,
      baselinePending,
    });
    expect(comparedByDefault(root(5, false))).toBe(true);
    expect(comparedByDefault(root(null, true))).toBe(true);
    expect(comparedByDefault(root(null, false))).toBe(false);
  });

  it("hides Change by default without a baseline, unless the user showed it", () => {
    expect(withDefaults(DEFAULT_VIEW, true)).toBe(DEFAULT_VIEW);
    expect(withDefaults(DEFAULT_VIEW, false).hidden).toEqual(["change"]);
    expect(visibleColumns(withDefaults(DEFAULT_VIEW, false), false).map((c) => c.id)).not.toContain(
      "change",
    );
    // Shown from the menu while there is no baseline: the choice is stored and wins.
    const shown = toggleColumn(DEFAULT_VIEW, "change", false);
    expect(shown.shown).toEqual(["change"]);
    expect(withDefaults(shown, false).hidden).toEqual([]);
    const restored = parseView(serializeView(shown));
    expect(withDefaults(restored, false).hidden).toEqual([]);
    // Hidden by the user while there is a baseline: it stays hidden with one too.
    const off = toggleColumn(DEFAULT_VIEW, "change", true);
    expect(withDefaults(off, true).hidden).toEqual(["change"]);
    expect(toggleColumn(off, "change", true)).toEqual({ ...DEFAULT_VIEW, shown: ["change"] });
  });

  it("show Before and Change by default in Grew most only, the user's choice winning", () => {
    const listed = (view: ColumnView, list: ListKind) =>
      visibleColumns(withDefaults(view, true, list), true).map((c) => c.id);
    expect(listed(DEFAULT_VIEW, "grewMost")).toEqual(expect.arrayContaining(["before", "change"]));
    expect(listed(DEFAULT_VIEW, "largest")).not.toContain("before");
    expect(listed(DEFAULT_VIEW, "largest")).not.toContain("change");
    expect(withDefaults(DEFAULT_VIEW, true, "largest").hidden).toEqual(["before", "change"]);
    expect(withDefaults(DEFAULT_VIEW, false, "largest").hidden).toEqual(["before", "change"]);
    // Search results start like the largest files and folders.
    expect(withDefaults(DEFAULT_VIEW, true, "search").hidden).toEqual(["before", "change"]);
    expect(listed(DEFAULT_VIEW, "search")).toContain("path");
    expect(withDefaults(DEFAULT_VIEW, true, "grewMost")).toBe(DEFAULT_VIEW);
    expect(withDefaults(DEFAULT_VIEW, false, "grewMost")).toBe(DEFAULT_VIEW);
    // Shown in another list: it stays shown there.
    const shown = toggleColumn(DEFAULT_VIEW, "before", true, "largest");
    expect(listed(shown, "largest")).toContain("before");
    expect(listed(toggleColumn(DEFAULT_VIEW, "change", true, "largest"), "largest")).toContain(
      "change",
    );
    // Hidden in Grew most: it stays hidden there.
    const off = toggleColumn(DEFAULT_VIEW, "before", true, "grewMost");
    expect(listed(off, "grewMost")).not.toContain("before");
  });

  it("lays out only the visible columns, in their order", () => {
    const view = {
      order: moveColumn(ids, "owner", "len"),
      hidden: ["len", "files"] as ColumnId[],
      shown: [],
    };
    const columns = visibleColumns(view, false);
    expect(columns.map((c) => c.id).slice(0, 3)).toEqual(["name", "owner", "size"]);
    // Two hidden, and Path and Before exist in the flat lists only.
    expect(columns).toHaveLength(ids.length - 4);
    const widths = { ...DEFAULT_WIDTHS, name: 300, owner: 100 };
    expect(gridTemplate(columns, widths).split(" ").slice(0, 2)).toEqual(["300px", "100px"]);
    expect(totalWidth(columns, widths)).toBe(columns.reduce((sum, c) => sum + widths[c.id], 0));
  });

  it("shows the Path and Before columns in the flat lists only, Path after Name by default", () => {
    expect(visibleColumns(DEFAULT_VIEW, true)[1].id).toBe("path");
    expect(visibleColumns(DEFAULT_VIEW, true).map((c) => c.id)).toContain("before");
    const contents = visibleColumns(DEFAULT_VIEW, false).map((c) => c.id);
    expect(contents).not.toContain("path");
    expect(contents).not.toContain("before");
    expect(contents).toContain("change");
  });
});

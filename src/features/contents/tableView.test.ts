import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { tableKeyDown, type RowActions } from "./tableView";

type Mods = Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "repeat", boolean>> & {
  code?: string;
};

/** A key event on the table itself (or on a header button with `onHeader`). */
function press(key: string, mods: Mods = {}, onHeader = false) {
  const table = { querySelector: () => null };
  const event = {
    key,
    code: "",
    repeat: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
    currentTarget: table,
    target: onHeader ? {} : table,
    preventDefault: vi.fn(),
  };
  return event as unknown as KeyboardEvent<HTMLDivElement> & { preventDefault: () => void };
}

const actions = (): RowActions => ({
  point: vi.fn(),
  markAll: vi.fn(),
  trash: vi.fn(),
  open: vi.fn(),
  menuAt: vi.fn(),
  up: vi.fn(),
});
// 240 px under the header: 10 rows, a page moves 9.
const table = { cursor: 3, viewport: 240, count: 50 };

describe("tableKeyDown", () => {
  it("moves the cursor with the navigation keys", () => {
    const a = actions();
    for (const key of ["ArrowDown", "ArrowUp", "PageDown", "Home", "End"]) {
      tableKeyDown(press(key), table, a, false);
    }
    expect(vi.mocked(a.point).mock.calls).toEqual([
      [4, "one"],
      [2, "one"],
      [12, "one"],
      [0, "one"],
      [49, "one"],
    ]);
  });

  it("extends the marks with Shift and marks all with Ctrl+A, also from a header button", () => {
    const a = actions();
    tableKeyDown(press("ArrowDown", { shiftKey: true }), table, a, false);
    // Ctrl+A on any keyboard layout: the key is known by its place.
    const all = press("ф", { ctrlKey: true, code: "KeyA" }, true);
    tableKeyDown(all, table, a, false);
    expect(vi.mocked(a.point).mock.calls).toEqual([[4, "range"]]);
    expect(a.markAll).toHaveBeenCalledOnce();
    expect(all.preventDefault).toHaveBeenCalled();
  });

  it("moves the marks to the trash with Delete, never with Shift and not while it repeats", () => {
    const a = actions();
    tableKeyDown(press("Delete"), table, a, false);
    tableKeyDown(press("Delete", { shiftKey: true }), table, a, false);
    tableKeyDown(press("Delete", { repeat: true }), table, a, false);
    expect(a.trash).toHaveBeenCalledOnce();
  });

  it("deletes for good with Shift+Delete only where the table offers it, never while it repeats", () => {
    const plain = actions();
    tableKeyDown(press("Delete", { shiftKey: true }), table, plain, false);
    expect(plain.trash).not.toHaveBeenCalled();

    const cleanup = { ...actions(), purge: vi.fn() };
    tableKeyDown(press("Delete", { shiftKey: true }), table, cleanup, false);
    expect(cleanup.purge).toHaveBeenCalledOnce();
    expect(cleanup.trash).not.toHaveBeenCalled();
    tableKeyDown(press("Delete", { shiftKey: true, repeat: true }), table, cleanup, false);
    tableKeyDown(press("Delete", { shiftKey: true, ctrlKey: true }), table, cleanup, false);
    expect(cleanup.purge).toHaveBeenCalledOnce();
    // Delete alone still moves to the trash.
    tableKeyDown(press("Delete"), table, cleanup, false);
    expect(cleanup.trash).toHaveBeenCalledOnce();
    expect(cleanup.purge).toHaveBeenCalledOnce();
  });

  it("opens the cursor row once per press and goes up", () => {
    const a = actions();
    tableKeyDown(press("Enter"), table, a, false);
    tableKeyDown(press("Enter", { repeat: true }), table, a, false);
    tableKeyDown(press("Backspace"), table, a, false);
    tableKeyDown(press("ArrowUp", { altKey: true }), table, a, false);
    expect(vi.mocked(a.open).mock.calls).toEqual([[3]]);
    expect(a.up).toHaveBeenCalledTimes(2);
    expect(a.point).not.toHaveBeenCalled();
  });

  it("leaves the keys of the header buttons and other keys alone", () => {
    const a = actions();
    const onHeader = press("Enter", {}, true);
    tableKeyDown(onHeader, table, a, false);
    const other = press("x");
    tableKeyDown(other, table, a, false);
    expect(a.open).not.toHaveBeenCalled();
    expect(onHeader.preventDefault).not.toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it("takes the menu key even on a header button, and without a cursor row opens nothing", () => {
    const a = actions();
    const e = press("F10", { shiftKey: true }, true);
    tableKeyDown(e, { ...table, cursor: null }, a, false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(a.menuAt).not.toHaveBeenCalled();
  });
});

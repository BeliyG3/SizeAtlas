import { describe, expect, it } from "vitest";
import { followSelection, type ListBase, type ListSelection } from "./base";

/** A new selection object, as every choice makes one. */
const sel = (id: number, folder = id): ListSelection => ({ id, folder });
const start: ListBase = { base: 1, selection: sel(1), picked: null };

describe("folder of a flat list", () => {
  it("follows every new selection to its folder", () => {
    expect(followSelection(start, start.selection, true)).toBe(start);
    expect(followSelection(start, sel(7), true)).toMatchObject({ base: 7, picked: null });
    // A file chosen elsewhere: the list of its folder.
    expect(followSelection(start, sel(5, 3), true).base).toBe(3);
  });

  it("stays when an item of the list was picked", () => {
    // A file deep below: its folder becomes the current one, the list stays.
    const file = followSelection({ ...start, picked: 42 }, sel(42, 9), true);
    expect(file).toMatchObject({ base: 1, picked: null });
    // A folder of the list becomes the current folder itself.
    const folder = followSelection({ ...file, picked: 12 }, sel(12), true);
    expect(folder.base).toBe(1);
    // A folder chosen elsewhere (tree, crumbs, chart, Back) moves the list.
    expect(followSelection({ ...file, picked: 12 }, sel(3), true).base).toBe(3);
    // The same folder chosen again in the tree: the list is made for it.
    expect(followSelection(folder, sel(12), true).base).toBe(12);
    expect(followSelection(file, sel(9), true).base).toBe(9);
  });

  it("is the current folder while no list is shown", () => {
    const file: ListBase = { base: 1, selection: sel(42, 9), picked: null };
    expect(followSelection(file, file.selection, false).base).toBe(9);
    expect(followSelection({ ...start, picked: 4 }, sel(4, 2), false).base).toBe(2);
    const shown = { ...start };
    expect(followSelection(shown, shown.selection, false)).toBe(shown);
  });

  it("stays when a change took the selected item away, unless it took the list's own folder", () => {
    // An item picked in the list went to the trash: the selection falls back to its folder.
    const picked: ListBase = { base: 1, selection: sel(42, 9), picked: null };
    expect(followSelection(picked, { ...sel(9), fallbackOf: 42 }, true).base).toBe(1);
    // The folder of the list itself went: the list goes to where the selection fell back.
    const own: ListBase = { base: 9, selection: sel(9), picked: null };
    expect(followSelection(own, { ...sel(3), fallbackOf: 9 }, true).base).toBe(3);
  });
});

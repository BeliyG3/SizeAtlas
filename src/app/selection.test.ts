import { describe, expect, it } from "vitest";
import type { Summary } from "../api/types";
import type { RootEntry } from "./roots";
import {
  followEntries,
  neighbour,
  resolveSelection,
  rootSelection,
  type Selection,
} from "./selection";

const entry = (root: string, generation: number | null): RootEntry => ({
  root,
  summary: generation === null ? null : ({ root, generation } as Summary),
  status: generation === null ? "queued" : "open",
});

describe("resolveSelection", () => {
  const entries = [entry("C:\\", 1), entry("D:\\", 2)];

  it("keeps the chosen node while its root keeps its tree", () => {
    const chosen: Selection = { root: "D:\\", generation: 2, id: 5, folder: 5 };
    expect(resolveSelection(chosen, entries)).toBe(chosen);
  });

  it("goes to the root of the new tree after a rescan", () => {
    const chosen: Selection = { root: "D:\\", generation: 2, id: 5, folder: 4 };
    expect(resolveSelection(chosen, [entry("C:\\", 1), entry("D:\\", 7)])).toEqual(
      rootSelection("D:\\", 7),
    );
  });

  it("selects a root without a tree by its path", () => {
    const chosen = rootSelection("E:\\");
    expect(resolveSelection(chosen, [...entries, entry("E:\\", null)])).toBe(chosen);
  });

  it("keeps a remembered root that is not listed yet while restoring", () => {
    const chosen = rootSelection("D:\\");
    expect(resolveSelection(chosen, [entry("C:\\", 1)], true)).toBe(chosen);
    expect(resolveSelection(chosen, [], true)).toBe(chosen);
    expect(resolveSelection(null, [entry("C:\\", 1)], true)).toEqual(rootSelection("C:\\", 1));
    expect(resolveSelection(chosen, [entry("C:\\", 1)], false)).toEqual(rootSelection("C:\\", 1));
  });

  it("falls back to the first root, or to nothing", () => {
    expect(resolveSelection(rootSelection("Z:\\"), entries)).toEqual(rootSelection("C:\\", 1));
    expect(resolveSelection(null, entries)).toEqual(rootSelection("C:\\", 1));
    expect(resolveSelection(rootSelection("C:\\", 1), [])).toBeNull();
  });
});

describe("neighbour", () => {
  const before = [entry("A", 1), entry("B", 2), entry("C", null)];
  const without = (...gone: string[]) => before.filter((e) => !gone.includes(e.root));

  it("is the next root still listed, or the one before the last", () => {
    expect(neighbour(before, without("B"), "B")).toBe("C");
    expect(neighbour(before, without("C"), "C")).toBe("B");
    expect(neighbour(before, without("A", "B"), "A")).toBe("C");
    expect(neighbour(before, without("B", "C"), "C")).toBe("A");
  });

  it("is nothing while the root is listed, for an unknown root, or when none is left", () => {
    expect(neighbour(before, before, "B")).toBeNull();
    expect(neighbour(before, without("B"), "Z")).toBeNull();
    expect(neighbour([entry("A", 1)], [], "A")).toBeNull();
  });
});

describe("followEntries", () => {
  it("keeps the tree of the chosen root in the choice, so the selection stays one object", () => {
    const restored = rootSelection("C:\\");
    const first = followEntries(restored, [], [entry("C:\\", 3)]);
    expect(first).toEqual(rootSelection("C:\\", 3));
    // Any later change of the list (a scan elsewhere) keeps the very same choice.
    const later = [entry("C:\\", 3), entry("D:\\", null)];
    expect(followEntries(first, [entry("C:\\", 3)], later)).toBe(first);
    expect(resolveSelection(first, later)).toBe(first);
  });

  it("keeps a remembered root that is not listed yet", () => {
    const restored = rootSelection("C:\\");
    expect(followEntries(restored, [], [entry("D:\\", 1)])).toBe(restored);
    expect(followEntries(null, [], [entry("D:\\", 1)])).toBeNull();
  });

  it("moves to the neighbour, with its tree, when the chosen root leaves", () => {
    const chosen: Selection = { root: "C:\\", generation: 1, id: 5, folder: 5 };
    const before = [entry("C:\\", 1), entry("D:\\", 2)];
    expect(followEntries(chosen, before, [entry("D:\\", 2)])).toEqual(rootSelection("D:\\", 2));
  });
});

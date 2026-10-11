import { describe, expect, it } from "vitest";
import { ROOT_ID, type Summary } from "../api/types";
import { emptyHistory, restore, step, visit, type History, type Visit } from "./history";
import type { RootEntry } from "./roots";

const at = (folder: number, root = "C:\\", generation: number | null = 1): Visit => ({
  root,
  generation,
  folder,
});
const visits = (...folders: number[]): History =>
  folders.reduce((h, f) => visit(h, at(f)), emptyHistory);
const keep = (v: Visit) => v;
const entry = (root: string, generation: number | null): RootEntry => ({
  root,
  summary: generation === null ? null : ({ root, generation } as Summary),
  status: generation === null ? "queued" : "open",
});

describe("visit", () => {
  it("adds the folder after the current one", () => {
    const h = visits(1, 2, 3);
    expect(h.entries).toEqual([at(1), at(2), at(3)]);
    expect(h.at).toBe(2);
  });

  it("does not repeat the current folder", () => {
    const h = visits(1, 2);
    expect(visit(h, at(2))).toBe(h);
  });

  it("drops the forward entries", () => {
    const back = step(visits(1, 2, 3), -1, keep)!.history;
    const h = visit(back, at(9));
    expect(h.entries).toEqual([at(1), at(2), at(9)]);
    expect(h.at).toBe(2);
  });

  it("keeps the latest entries up to the limit", () => {
    const h = [1, 2, 3, 4].reduce((acc, f) => visit(acc, at(f), 3), emptyHistory);
    expect(h.entries).toEqual([at(2), at(3), at(4)]);
    expect(h.at).toBe(2);
  });
});

describe("step", () => {
  it("goes back and forward", () => {
    const back = step(visits(1, 2, 3), -1, keep)!;
    expect(back.visit).toEqual(at(2));
    expect(back.history.at).toBe(1);
    const forward = step(back.history, 1, keep)!;
    expect(forward.visit).toEqual(at(3));
    expect(forward.history.at).toBe(2);
  });

  it("has nowhere to go at either end", () => {
    expect(step(emptyHistory, -1, keep)).toBeNull();
    expect(step(visits(1), -1, keep)).toBeNull();
    expect(step(visits(1, 2), 1, keep)).toBeNull();
  });

  it("skips the entries that cannot be shown, in the same direction", () => {
    const back = step(visits(1, 2, 3), -1, (v) => (v.folder === 2 ? null : v))!;
    expect(back.visit).toEqual(at(1));
    expect(back.history.at).toBe(0);
    expect(step(visits(1, 2), -1, () => null)).toBeNull();
  });

  it("stores the folder it lands on in place of the entry", () => {
    const back = step(visits(1, 2), -1, () => at(ROOT_ID, "C:\\", 5))!;
    expect(back.history.entries).toEqual([at(ROOT_ID, "C:\\", 5), at(2)]);
  });
});

describe("restore", () => {
  const entries = [entry("C:\\", 1), entry("D:\\", 2)];

  it("shows the folder while its root keeps the tree", () => {
    expect(restore(at(7, "D:\\", 2), entries, null)).toEqual(at(7, "D:\\", 2));
  });

  it("skips a root that is no longer open", () => {
    expect(restore(at(7, "E:\\", 3), entries, null)).toBeNull();
  });

  it("goes to the root of a tree that was replaced", () => {
    expect(restore(at(7, "D:\\", 1), entries, null)).toEqual(at(ROOT_ID, "D:\\", 2));
  });

  it("skips what the view already shows", () => {
    const shown = { root: "D:\\", generation: 2, id: 9, folder: ROOT_ID };
    expect(restore(at(7, "D:\\", null), entries, shown)).toBeNull();
  });
});

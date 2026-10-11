import { describe, expect, it } from "vitest";
import type { Roots, Summary } from "../api/types";
import { liveRoots } from "./liveRoots";
import { storedRoots } from "./roots";

const summary = (rev: number, scanning = true): Summary => ({
  generation: 1,
  rev,
  rootId: 0,
  root: "/root",
  total: rev * 10,
  files: rev,
  len: rev * 10,
  dirs: 2,
  scannedAt: 1,
  sizeMode: "Allocated",
  accessErrors: 0,
  approximate: false,
  volume: null,
  scanning,
});
const snapshot = (rev: number, scanning = true): Roots => ({
  roots: [summary(rev, scanning)],
  queue: [],
});

describe("live root snapshots", () => {
  it("shows the first tree immediately and coalesces revisions while accepting queue changes", () => {
    const first = liveRoots({ roots: [], queue: [] }, snapshot(1), 100, 2000, new Map());
    expect(first.roots.roots[0].rev).toBe(1);
    const next = snapshot(5);
    next.queue = [{ root: "/next", state: "queued", folder: null }];
    const held = liveRoots(first.roots, next, 1000, 2000, first.last);
    expect(held.roots.roots[0]).toBe(first.roots.roots[0]);
    expect(held.roots.queue).toEqual(next.queue);
    expect(held.wait).toBe(1100);
    const updated = liveRoots(held.roots, snapshot(8), 2100, 2000, held.last);
    expect(updated.roots.roots[0].rev).toBe(8);
    expect(updated.wait).toBeNull();
  });
  it("uses a slower measured interval and immediately accepts completion and cancellation", () => {
    const first = liveRoots({ roots: [], queue: [] }, snapshot(1), 0, 2000, new Map());
    expect(liveRoots(first.roots, snapshot(2), 2000, 6000, first.last).wait).toBe(4000);
    expect(
      liveRoots(first.roots, snapshot(2, false), 100, 6000, first.last).roots.roots[0].rev,
    ).toBe(2);
    const cancelled = liveRoots(first.roots, { roots: [], queue: [] }, 100, 6000, first.last);
    expect(cancelled.roots.roots).toEqual([]);
    expect(cancelled.last.size).toBe(0);
  });
  it("leaves normal edits and rescans immediate and remembers only completed trees", () => {
    const first = snapshot(1, false);
    expect(liveRoots(first, snapshot(2, false), 100, 2000, new Map([[1, 0]])).wait).toBeNull();
    expect(storedRoots(snapshot(1))).toBe("[]");
    expect(storedRoots(first)).toBe('["/root"]');
  });
});

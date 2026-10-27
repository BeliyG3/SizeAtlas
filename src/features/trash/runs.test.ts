import { describe, expect, it } from "vitest";
import type { TrashProgress } from "../../api/types";
import { applyProgress, dupPending, isRemoving, removingState, shownRuns, type Run } from "./runs";

const run = (request: number, more: Partial<Run> = {}): Run => ({
  request,
  generation: 1,
  root: "/root",
  ids: [request],
  preview: { count: 1, size: 1, scannedAt: 1, paths: [], binFree: null, binSize: 0 },
  purge: false,
  progress: null,
  stopping: false,
  ...more,
});
const at = (request: number, done = 0): TrashProgress => ({
  request,
  done,
  total: 5,
  current: "/a",
});

describe("applyProgress", () => {
  it("sets the progress of the run it belongs to and no other", () => {
    const runs = [run(1), run(2)];
    const next = applyProgress(runs, at(2, 3));
    expect(next[0]).toBe(runs[0]);
    expect(next[1].progress).toEqual(at(2, 3));
  });

  it("drops an event of a request that is no run", () => {
    const runs = [run(1, { progress: at(1, 2) })];
    expect(applyProgress(runs, at(9, 4))).toBe(runs);
  });

  it("keeps the progress of a run when a foreign event comes after its own", () => {
    const own = applyProgress([run(1)], at(1, 2));
    const after = applyProgress(own, at(7, 1));
    expect(after[0].progress).toEqual(at(1, 2));
  });
});

describe("removingState", () => {
  it("says queued before the first progress, then how it goes", () => {
    const queued = [run(5, { ids: [5, 9] })];
    expect(removingState(queued, 1, 9)).toBe("queued");
    const started = applyProgress(queued, at(5));
    expect(removingState(started, 1, 9)).toBe("trash");
    const purge = [run(5, { ids: [5], purge: true, progress: at(5) })];
    expect(removingState(purge, 1, 5)).toBe("purge");
  });

  it("knows nothing of another tree or of another item", () => {
    const runs = [run(5, { progress: at(5) })];
    expect(removingState(runs, 2, 5)).toBeUndefined();
    expect(removingState(runs, 1, 6)).toBeUndefined();
  });

  it("prefers the run that started over one that waits for the same item", () => {
    const runs = [run(1, { ids: [4] }), run(2, { ids: [4], progress: at(2) })];
    expect(removingState(runs, 1, 4)).toBe("trash");
  });
});

describe("isRemoving", () => {
  it("is true when any run of the tree has any of the items", () => {
    const runs = [
      run(1, { ids: [1, 5] }),
      run(2, { ids: [9] }),
      run(3, { generation: 2, ids: [4] }),
    ];
    expect(isRemoving(runs, 1, [5, 9])).toBe(true);
    expect(isRemoving(runs, 1, [9, 4])).toBe(true);
    expect(isRemoving(runs, 1, [4])).toBe(false);
    expect(isRemoving(runs, 1, [])).toBe(false);
  });
});

describe("a request of duplicates over several trees", () => {
  const more = [{ generation: 2, root: "/other", ids: [8, 9] }];
  it("removes the items of the other trees too, and its progress reaches them", () => {
    const runs = [run(1, { ids: [3], more })];
    expect(removingState(runs, 2, 9)).toBe("queued");
    expect(isRemoving(runs, 2, [7, 8])).toBe(true);
    expect(isRemoving(runs, 2, [3])).toBe(false);
    expect(isRemoving(runs, 1, [3])).toBe(true);
    expect(removingState(applyProgress(runs, at(1, 2)), 2, 8)).toBe("trash");
  });
});

describe("dupPending", () => {
  it("is true while a request of duplicates runs or waits, and only then", () => {
    expect(dupPending([run(1)])).toBe(false);
    expect(dupPending([run(1), run(2, { more: [] })])).toBe(true);
    expect(dupPending([])).toBe(false);
  });
});

describe("shownRuns", () => {
  it("shows the first two that started and counts the rest, never a waiting one", () => {
    const started = (n: number) => run(n, { progress: at(n) });
    const { shown, more } = shownRuns([started(1), run(2), started(3), started(4)]);
    expect(shown.map((r) => r.request)).toEqual([1, 3]);
    expect(more).toBe(1);
    expect(shownRuns([started(1), started(2), started(3), started(4)], 3).more).toBe(1);
  });
});

describe("rows while progress events come", () => {
  // Every event makes a new runs array; a memoized row only re-renders when its own state changes.
  it("keeps the state of every row and the item sets of the runs", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    const before = [run(1, { ids }), run(2, { ids: [20_000] })];
    const states = (runs: readonly Run[]) =>
      [0, 5_000, 9_999, 20_000, 30_000].map((id) => removingState(runs, 1, id));
    const waiting = states(before);
    const after = applyProgress(before, at(2, 1));
    expect(after).not.toBe(before);
    expect(after[0].ids).toBe(ids);
    // Only the run that got the event changes: the rows of the other one keep their state.
    expect(states(after)).toEqual([...waiting.slice(0, 3), "trash", undefined]);
  });
});

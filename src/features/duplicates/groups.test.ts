import { describe, expect, it } from "vitest";
import { answer, group, status } from "./dup.testSupport";
import { applyAnswer, shouldFetch, sortGroups, totalFree } from "./groups";

const keys = (state: { groups: ReadonlyMap<string, unknown> }) => [...state.groups.keys()].sort();

describe("the groups of a duplicates result", () => {
  it("take a full answer as the whole result", () => {
    const first = applyAnswer(null, answer({ job: 1, version: 2, groups: [group("a")] }));
    expect(first.job).toBe(1);
    expect(first.version).toBe(2);
    const next = applyAnswer(
      first,
      answer({ job: 1, version: 3, full: true, groups: [group("b"), group("c")] }),
    );
    expect(keys(next)).toEqual(["b", "c"]);
    expect(next.version).toBe(3);
  });

  it("add, replace and remove groups by a change", () => {
    const first = applyAnswer(
      null,
      answer({ job: 1, version: 2, groups: [group("a"), group("b", 10)] }),
    );
    const next = applyAnswer(
      first,
      answer({
        job: 1,
        version: 4,
        full: false,
        groups: [group("b", 99), group("c")],
        removed: ["a"],
      }),
    );
    expect(keys(next)).toEqual(["b", "c"]);
    expect(next.groups.get("b")!.free).toBe(99);
    expect(next.version).toBe(4);
    expect(next.answer.version).toBe(4);
  });

  it("ignore an answer of an older job", () => {
    const state = applyAnswer(null, answer({ job: 2, version: 1, groups: [group("a")] }));
    expect(applyAnswer(state, answer({ job: 1, version: 9, groups: [group("x")] }))).toBe(state);
  });

  it("never roll the groups back by a late change, but take its stale mark", () => {
    const state = applyAnswer(null, answer({ job: 1, version: 5, groups: [group("a")] }));
    const late = applyAnswer(
      state,
      answer({ job: 1, version: 3, full: false, stale: true, removed: ["a"] }),
    );
    expect(late.groups).toBe(state.groups);
    expect(late.version).toBe(5);
    expect(late.answer.stale).toBe(true);
  });

  it("are fetched for a new job or a newer version only", () => {
    const state = applyAnswer(null, answer({ job: 2, version: 5 }));
    expect(shouldFetch(null, status({ job: 0 }))).toBe(true);
    expect(shouldFetch(state, status({ job: 1, version: 9 }))).toBe(false);
    expect(shouldFetch(state, status({ job: 2, version: 5 }))).toBe(false);
    expect(shouldFetch(state, status({ job: 2, version: 4 }))).toBe(false);
    expect(shouldFetch(state, status({ job: 2, version: 6 }))).toBe(true);
    expect(shouldFetch(state, status({ job: 3, version: 0 }))).toBe(true);
  });

  it("sort by what can be freed, the larger first, then by key", () => {
    const sorted = sortGroups([group("b", 10), group("c", 30), group("a", 30)]);
    expect(sorted.map((g) => g.key)).toEqual(["a", "c", "b"]);
  });

  it("add up what can be freed", () => {
    expect(totalFree([group("a", 10), group("b", 32)])).toBe(42);
    expect(totalFree([])).toBe(0);
  });
});

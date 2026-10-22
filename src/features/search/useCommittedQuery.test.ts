import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommittedQuery } from "./useCommittedQuery";

// A minimal hook runtime: state, effects and render-time updates survive explicit renders.
const rt = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown };
  const state = { slots: [] as Slot[], at: 0, dirty: false, queue: [] as (() => void)[] };
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  return {
    state,
    hooks: {
      useState: (initial: unknown) => {
        const s = (state.slots[state.at++] ??= {});
        if (!("value" in s)) s.value = initial;
        return [
          s.value,
          (next: unknown) => {
            if (!Object.is(next, s.value)) {
              s.value = next;
              state.dirty = true;
            }
          },
        ];
      },
      useEffect: (run: () => unknown, deps?: readonly unknown[]) => {
        const s = (state.slots[state.at++] ??= {});
        if (!changed(s.deps, deps)) return;
        s.deps = deps;
        state.queue.push(() => {
          if (typeof s.cleanup === "function") (s.cleanup as () => void)();
          s.cleanup = run();
        });
      },
    },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...rt.hooks,
}));

const Probe = (query: string) => useCommittedQuery(query);

function Render(query: string) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    const result = Probe(query);
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return result;
  }
  throw new Error("never settled");
}

beforeEach(() => {
  rt.state.slots = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useCommittedQuery", () => {
  it("passes the query on 250 ms after the last keystroke", () => {
    expect(Render("a").committed).toBe("");
    vi.advanceTimersByTime(200);
    Render("ab");
    vi.advanceTimersByTime(200);
    expect(Render("ab").committed).toBe("");
    vi.advanceTimersByTime(50);
    expect(Render("ab").committed).toBe("ab");
  });

  it("passes it on at once when committed", () => {
    const { commit } = Render("abc");
    commit("abc");
    expect(Render("abc").committed).toBe("abc");
  });

  it("drops it at once when the field is emptied", () => {
    Render("abc");
    vi.advanceTimersByTime(250);
    expect(Render("abc").committed).toBe("abc");
    expect(Render("").committed).toBe("");
  });

  it("does not bring the old query back when typing starts again", () => {
    Render("abc");
    vi.advanceTimersByTime(250);
    Render("abc");
    Render("");
    expect(Render("x").committed).toBe("");
    vi.advanceTimersByTime(250);
    expect(Render("x").committed).toBe("x");
  });

  it("does not search again for a space typed or taken away", () => {
    Render("backup");
    vi.advanceTimersByTime(250);
    const first = Render("backup").committed;
    expect(first).toBe("backup");
    Render("backup ");
    rt.state.dirty = false;
    vi.advanceTimersByTime(250);
    expect(rt.state.dirty).toBe(false);
    expect(Render("backup ").committed).toBe("backup");
  });

  it("passes the words on with single spaces", () => {
    Render(" a   b ");
    vi.advanceTimersByTime(250);
    expect(Render(" a   b ").committed).toBe("a b");
    const { commit } = Render(" a  c ");
    commit(" a  c ");
    expect(Render(" a  c ").committed).toBe("a c");
  });

  it("treats blanks as no query", () => {
    Render("abc");
    vi.advanceTimersByTime(250);
    expect(Render("   ").committed).toBe("");
  });
});

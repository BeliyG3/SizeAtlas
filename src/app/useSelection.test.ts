import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Summary } from "../api/types";
import type { RootEntry } from "./roots";
import { useSelection } from "./useSelection";

// A minimal hook runtime: state, memos, refs and effects survive explicit renders, without a DOM.
const rt = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown };
  const state = { slots: [] as Slot[], at: 0, dirty: false, queue: [] as (() => void)[] };
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const slot = (): Slot => (state.slots[state.at++] ??= {});
  const memo = (make: () => unknown, deps?: readonly unknown[]) => {
    const s = slot();
    if (changed(s.deps, deps)) {
      s.value = make();
      s.deps = deps;
    }
    return s.value;
  };
  const effect = (run: () => unknown, deps?: readonly unknown[]) => {
    const s = slot();
    if (!changed(s.deps, deps)) return;
    s.deps = deps;
    state.queue.push(() => {
      if (typeof s.cleanup === "function") (s.cleanup as () => void)();
      s.cleanup = run();
    });
  };
  return {
    state,
    hooks: {
      useState: (initial: unknown) => {
        const s = slot();
        if (!("value" in s)) s.value = typeof initial === "function" ? initial() : initial;
        return [
          s.value,
          (next: unknown) => {
            const value = typeof next === "function" ? next(s.value) : next;
            if (!Object.is(value, s.value)) {
              s.value = value;
              state.dirty = true;
            }
          },
        ];
      },
      useRef: (initial: unknown) => {
        const s = slot();
        if (!("value" in s)) s.value = { current: initial };
        return s.value;
      },
      useMemo: memo,
      useCallback: (callback: unknown, deps?: readonly unknown[]) => memo(() => callback, deps),
      useLayoutEffect: effect,
      useEffect: effect,
    },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...rt.hooks,
}));
vi.mock("../api/client", () => ({ api: { getLiveAncestor: vi.fn(), getCrumbs: vi.fn() } }));
vi.mock("./useHistory", () => ({ useHistory: () => ({ record: () => {} }) }));

const entry = (rev: number): RootEntry[] => [
  { root: "/r", status: "open", summary: { generation: 1, rev } as Summary },
];

/** One render of the hook, as the app shell does. */
const Shell = (entries: RootEntry[]) => useSelection(entries, () => {}, false);

/** The hook once its state has settled. */
function render(entries: RootEntry[]) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    const shown = Shell(entries);
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return shown;
  }
  throw new Error("the selection never settled");
}

beforeEach(() => {
  rt.state.slots = [];
  // Nothing is gone until a test says so.
  vi.mocked(api.getLiveAncestor).mockImplementation((_, id) => Promise.resolve(id));
});

describe("useSelection after a delete", () => {
  it("moves from a deleted folder, such as a row of its own clean-up list, to its nearest live ancestor", async () => {
    const before = entry(1);
    render(before).selectNode(1, 5, true);
    expect(render(before).selection).toMatchObject({ id: 5, folder: 5 });

    // The folder went (deleted for good): the tree is at a new revision.
    vi.mocked(api.getLiveAncestor).mockResolvedValue(2);
    const after = entry(2);
    render(after);
    expect(api.getLiveAncestor).toHaveBeenLastCalledWith(1, 5);
    await Promise.resolve();
    expect(render(after).selection).toMatchObject({ id: 2, folder: 2, fallbackOf: 5 });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { api } from "../../api/client";
import type { List, Summary } from "../../api/types";
import { ListTable } from "./ListTable";

// The same minimal hook runtime as ContentsTable.live.test.tsx: state, memos and effects survive
// explicit renders, without a DOM.
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
      useContext: () => () => () => {},
    },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getList: vi.fn() } }));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));

const summary = {
  generation: 1,
  rev: 3,
  scanning: false,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
  sizeMode: "Allocated",
} as Summary;

const answer = (found: List["found"]): List => ({
  generation: 1,
  rev: 3,
  size: 500,
  truncated: false,
  items: [],
  found,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

// Stable, as the parent's are: a new one would run the effects again.
const none = () => {};
const details = new Map();

let shown: ReactElement | null = null;

function render(query: string) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = ListTable({
      summary,
      kind: "search",
      query,
      base: 1,
      basePath: "/root",
      parent: null,
      selectedId: 1,
      details,
      onNeedDetails: none,
      onPick: none,
      onEnter: none,
      onMenu: none,
      onTrash: none,
      onMarks: none,
      onFail: none,
    }) as ReactElement;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the table never settled");
}

async function settle(query: string) {
  render(query);
  await Promise.resolve();
  render(query);
}

/** The text of every element of the shown tree that has the class `name`. */
function textOf(name: string): string[] {
  const found: string[] = [];
  const visit = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object" && "props" in node) {
      const props = node.props as { className?: string; children?: ReactNode };
      if (props.className?.split(" ").includes(name)) found.push([props.children].flat().join(""));
      visit(props.children);
    }
  };
  visit(shown);
  return found;
}

beforeEach(() => {
  rt.state.slots = [];
  vi.mocked(api.getList).mockReset();
});

describe("ListTable for a search", () => {
  it("asks for the query and again when it changes", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 0, size: 0 }));
    await settle("backup");
    expect(api.getList).toHaveBeenLastCalledWith(1, 1, "search", 1000, "backup");
    await settle("*.mp4");
    expect(api.getList).toHaveBeenCalledTimes(2);
    expect(api.getList).toHaveBeenLastCalledWith(1, 1, "search", 1000, "*.mp4");
  });

  it("shows the totals of all matches above the rows", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1234, size: 2048 }));
    await settle("backup");
    expect(textOf("found")).toEqual([
      'search.found {"count":1234,"items":"1,234","size":"2.00 KB"}',
    ]);
  });

  it("says nothing was found and shows no totals", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 0, size: 0 }));
    await settle("zzz");
    expect(textOf("found")).toEqual([]);
    expect(JSON.stringify(shown)).toContain("search.none");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { api } from "../../api/client";
import type { ChildrenPage, Item, Summary } from "../../api/types";
import { DEFAULT_SORT } from "./columns";
import { ContentsTable } from "./ContentsTable";

// A minimal hook runtime: state, memos and effects survive explicit renders, effects run after
// each render as React runs them (layout first, cleanup before setup), without a DOM.
const rt = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown };
  const state = {
    slots: [] as Slot[],
    at: 0,
    dirty: false,
    layout: [] as (() => void)[],
    passive: [] as (() => void)[],
  };
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
  const effect =
    (queue: "layout" | "passive") => (run: () => unknown, deps?: readonly unknown[]) => {
      const s = slot();
      if (!changed(s.deps, deps)) return;
      s.deps = deps;
      state[queue].push(() => {
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
      useLayoutEffect: effect("layout"),
      useEffect: effect("passive"),
      useContext: () => () => () => {},
    },
  };
});
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...rt.hooks,
}));
vi.mock("../../api/client", () => ({
  api: { getChildren: vi.fn(), getPosition: vi.fn() },
}));
// The mocked `useContext` answers every context with a function: nothing is being removed.
vi.mock("../trash/moving", () => ({ useMoving: () => () => undefined }));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key }) }));

const f = { id: 11, name: "f.txt", size: 300, isDir: false } as Item;
const g = { id: 12, name: "g.txt", size: 200, isDir: false } as Item;

const summary = (rev: number, scanning: boolean): Summary => ({
  root: "/root",
  rootId: 0,
  generation: 1,
  rev,
  scanning,
  total: 500,
  files: 2,
  len: 500,
  dirs: 1,
  accessErrors: 0,
  approximate: false,
  scannedAt: 1,
  sizeMode: "Allocated",
  volume: null,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

const page = (rev: number, items: Item[]): ChildrenPage => ({
  generation: 1,
  rev,
  approximate: false,
  size: 500,
  total: items.length,
  restCount: 0,
  restSize: 0,
  items,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

let shown: ReactElement | null = null;

function render(of: Summary) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = ContentsTable({
      summary: of,
      folder: 1,
      parent: 0,
      selectedId: 1,
      sort: DEFAULT_SORT,
      dirsOnly: false,
      onSort: () => {},
      details: new Map(),
      onNeedDetails: () => {},
      onSelect: () => {},
      onMenu: () => {},
      onTrash: () => {},
      onMarks: () => {},
      onFail: () => {},
    }) as ReactElement;
    for (const queue of [rt.state.layout, rt.state.passive]) {
      for (const run of queue.splice(0)) run();
    }
    if (!rt.state.dirty) return;
  }
  throw new Error("the table never settled");
}

/** Lets the fetch timer fire and the answers land, rendering after each step. */
async function settle(of: Summary) {
  render(of);
  for (let step = 0; step < 5; step++) {
    await vi.advanceTimersByTimeAsync(100);
    render(of);
  }
}

/** Names on the rows the table shows. */
function rowNames(): string[] {
  const names: string[] = [];
  const visit = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object" && "props" in node) {
      const props = node.props as { item?: Item; children?: ReactNode };
      if (props.item) names.push(props.item.name);
      visit(props.children);
    }
  };
  visit(shown);
  return names;
}

beforeEach(() => {
  vi.useFakeTimers();
  rt.state.slots = [];
  vi.mocked(api.getPosition).mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("ContentsTable during a first scan", () => {
  it("drops a trashed row at once and after the scan finishes", async () => {
    // Live: the backend runs ahead of the revision shown.
    vi.mocked(api.getChildren).mockResolvedValue(page(7, [f, g]));
    await settle(summary(5, true));
    expect(rowNames()).toEqual(["f.txt", "g.txt"]);

    // The trash: its revision is shown at once.
    vi.mocked(api.getChildren).mockResolvedValue(page(8, [g]));
    await settle(summary(8, true));
    expect(rowNames()).toEqual(["g.txt"]);

    // The scan finishes.
    vi.mocked(api.getChildren).mockResolvedValue(page(9, [g]));
    await settle(summary(9, false));
    expect(rowNames()).toEqual(["g.txt"]);
  });

  it("drops a trashed row from a scrolled second page", async () => {
    const many = Array.from(
      { length: 205 },
      (_, i) => ({ id: 100 + i, name: `n${i}`, size: 1000 - i, isDir: false }) as Item,
    );
    const withF = [...many.slice(0, 202), f, ...many.slice(202)];
    const serve = (rev: number, items: Item[]) =>
      vi.mocked(api.getChildren).mockImplementation((_g, _id, offset, limit) =>
        Promise.resolve({
          ...page(rev, items.slice(offset, offset + limit)),
          total: items.length,
        }),
      );
    serve(7, withF);
    await settle(summary(5, true));
    (shown!.props as { onScroll: (e: unknown) => void }).onScroll({
      currentTarget: { scrollTop: 4510 },
    });
    await settle(summary(5, true));
    expect(rowNames()).toContain("f.txt");
    serve(8, many);
    await settle(summary(8, true));
    expect(rowNames()).not.toContain("f.txt");
    serve(9, many);
    await settle(summary(9, false));
    expect(rowNames()).not.toContain("f.txt");
  });
});

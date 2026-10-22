import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { api } from "../../api/client";
import type { List, ListItem, Summary } from "../../api/types";
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

const row = (id: number) => ({ id, name: `f${id}`, isDir: false, deleted: false }) as ListItem;

const answer = (found: List["found"], items: ListItem[] = []): List => ({
  generation: 1,
  rev: 3,
  size: 500,
  truncated: false,
  items,
  found,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

// Stable, as the parent's are: a new one would run the effects again.
const none = () => {};
const onTrash = vi.fn();
const onMarks = vi.fn();
const onEnter = vi.fn();
const onOpenFolder = vi.fn();
const details = new Map();

let shown: ReactElement | null = null;

function render(query: string, leaves = true) {
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
      onEnter,
      onOpenFolder: leaves ? onOpenFolder : undefined,
      onMenu: none,
      onTrash,
      onMarks,
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

/** The grid element and a key pressed in it. */
const grid = () => (shown!.props as { children: ReactElement[] }).children.flat().at(-1)!;
function press(key: Partial<KeyboardEvent>) {
  const props = grid().props as { onKeyDown: (e: unknown) => void };
  const target = {};
  props.onKeyDown({ target, currentTarget: target, preventDefault: () => {}, ...key });
}

beforeEach(() => {
  rt.state.slots = [];
  vi.mocked(api.getList).mockReset();
  onTrash.mockReset();
  onMarks.mockReset();
  onEnter.mockReset();
  onOpenFolder.mockReset();
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

  it("drops the answer to an older query that arrives late", async () => {
    const pending = new Map<string, (list: List) => void>();
    vi.mocked(api.getList).mockImplementation(
      (...args) => new Promise((resolve) => pending.set(args[4]!, resolve)),
    );
    render("ab");
    render("abc");
    pending.get("abc")!(answer({ count: 3, size: 2048 }));
    await Promise.resolve();
    pending.get("ab")!(answer({ count: 9, size: 4096 }));
    await Promise.resolve();
    render("abc");
    expect(textOf("found")).toEqual([expect.stringContaining('"count":3')]);
  });

  it("keeps no marks of one query on the results of another", async () => {
    const pending = new Map<string, (list: List) => void>();
    vi.mocked(api.getList).mockImplementation(
      (...args) => new Promise((resolve) => pending.set(args[4]!, resolve)),
    );
    render("a");
    pending.get("a")!(answer({ count: 2, size: 2 }, [row(1), row(2)]));
    await Promise.resolve();
    render("a");
    press({ ctrlKey: true, code: "KeyA" });
    render("a");
    expect(onMarks).toHaveBeenLastCalledWith([1, 2]);

    // The new query is loading: the old rows and their marks are still on screen.
    render("ab");
    expect(onMarks).toHaveBeenLastCalledWith([1, 2]);
    pending.get("ab")!(answer({ count: 1, size: 1 }, [row(1)]));
    await Promise.resolve();
    render("ab");
    expect(onMarks).toHaveBeenLastCalledWith([]);
    press({ key: "Delete", repeat: false });
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("scrolls to the top when the results of another query arrive", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }, [row(1)]));
    await settle("a");
    const scrolled = { scrollTop: 800, querySelector: () => null };
    (grid().props as { ref: { current: unknown } }).ref.current = scrolled;
    await settle("a");
    expect(scrolled.scrollTop).toBe(800);
    await settle("ab");
    expect(scrolled.scrollTop).toBe(0);
  });

  it("announces the totals", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 2, size: 2 }));
    await settle("a");
    const line = (shown!.props as { children: ReactElement[] }).children[0];
    expect((line.props as { role?: string }).role).toBe("status");
  });

  describe("opening a folder of the results", () => {
    const folder = { id: 7, name: "backup", isDir: true, parent: 3, deleted: false } as ListItem;
    const rows = [folder];

    async function onFolder(leaves = true) {
      vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }, rows));
      await settle("backup");
      render("backup", leaves);
      press({ key: "ArrowDown" });
      render("backup", leaves);
    }

    it("leaves the search for the folder on Enter", async () => {
      await onFolder();
      press({ key: "Enter", repeat: false });
      expect(onOpenFolder).toHaveBeenCalledWith(7, 3);
      expect(onEnter).not.toHaveBeenCalled();
    });

    it("keeps Backspace in the search: the list of the parent", async () => {
      await onFolder();
      press({ key: "Backspace" });
      expect(onOpenFolder).not.toHaveBeenCalled();
    });

    it("enters the folder as other lists do when nothing is said about leaving", async () => {
      await onFolder(false);
      press({ key: "Enter", repeat: false });
      expect(onEnter).toHaveBeenCalledWith(7, 3);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ChildrenPage, Item, ListOrder } from "../../api/types";
import { pagesOf, withPage, type LoadedRoots, type RootInfo } from "./model";
import { useTreeData } from "./useTreeData";

const hooks = vi.hoisted(() => {
  type Effect = { deps: readonly unknown[]; cleanup?: () => void };
  const state = {
    values: [] as unknown[],
    refs: [] as { current: unknown }[],
    effects: [] as Effect[],
    layouts: [] as (() => void)[],
    passive: [] as (() => void)[],
    stateAt: 0,
    refAt: 0,
    effectAt: 0,
    dirty: false,
  };
  const effect = (
    callback: () => (() => void) | void,
    deps: readonly unknown[],
    queue: (() => void)[],
  ) => {
    const index = state.effectAt++;
    const previous = state.effects[index];
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    queue.push(() => {
      previous?.cleanup?.();
      state.effects[index] = { deps, cleanup: callback() ?? undefined };
    });
  };
  const beginRender = () => {
    state.stateAt = 0;
    state.refAt = 0;
    state.effectAt = 0;
    state.dirty = false;
  };
  const commit = () => {
    state.layouts.splice(0).forEach((run) => run());
    state.passive.splice(0).forEach((run) => run());
  };
  return { state, effect, beginRender, commit };
});

// Keep hook slots across renders and run committed effects without a DOM dependency.
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => {
    const index = hooks.state.refAt++;
    return (hooks.state.refs[index] ??= { current: value });
  },
  useState: (value: unknown) => {
    const index = hooks.state.stateAt++;
    if (!(index in hooks.state.values)) hooks.state.values[index] = value;
    return [
      hooks.state.values[index],
      (update: unknown) => {
        const previous = hooks.state.values[index];
        const next = typeof update === "function" ? update(previous) : update;
        if (!Object.is(previous, next)) hooks.state.dirty = true;
        hooks.state.values[index] = next;
      },
    ];
  },
  useLayoutEffect: (callback: () => (() => void) | void, deps: readonly unknown[]) =>
    hooks.effect(callback, deps, hooks.state.layouts),
  useEffect: (callback: () => (() => void) | void, deps: readonly unknown[]) =>
    hooks.effect(callback, deps, hooks.state.passive),
}));
vi.mock("../../api/client", () => ({
  api: { getChildren: vi.fn() },
  isCmdError: (error: unknown) => typeof error === "object" && error !== null && "code" in error,
}));

const order: ListOrder = { key: "name", descending: false, dirsOnly: true };
const onFail = vi.fn();
const item = (id: number): Item => ({
  id,
  name: `folder-${id}`,
  size: 100,
  len: 100,
  files: 1,
  dirs: 1,
  folders: 1,
  modified: 0,
  isDir: true,
  category: 255,
  accessError: false,
  cloud: false,
  lossy: false,
});
const page = (rev: number, id = 5): ChildrenPage => ({
  generation: 1,
  rev,
  approximate: false,
  size: 100,
  total: 1,
  restCount: 0,
  restSize: 0,
  items: [item(id)],
});
const roots = (rev: number): RootInfo[] => [
  {
    root: "C:",
    label: "C:",
    generation: 1,
    size: 100,
    rev,
    status: "open",
    scanning: false,
    drive: true,
  },
];

function useRenderTree(current: readonly RootInfo[]) {
  hooks.beginRender();
  const result = useTreeData(current, order, onFail);
  hooks.commit();
  return result;
}

function deferredPage() {
  let resolve!: (answer: ChildrenPage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ChildrenPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  // Per-page callback, Promise.all, and the batch updater each take a microtask.
  for (let step = 0; step < 4; step++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.state.values = [];
  hooks.state.refs = [];
  hooks.state.effects = [];
  hooks.state.layouts = [];
  hooks.state.passive = [];
});

describe("useTreeData", () => {
  it("lands a running batch, then plans the newest revision from its fresh pages", async () => {
    const first = deferredPage();
    const next = deferredPage();
    vi.mocked(api.getChildren).mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);

    useRenderTree(roots(1));
    useRenderTree(roots(2));
    useRenderTree(roots(3));
    expect(api.getChildren).toHaveBeenCalledTimes(1);

    first.resolve(page(1));
    await settle();
    expect(pagesOf(hooks.state.values[0] as LoadedRoots, 1).get(0)?.rev).toBe(1);
    expect(hooks.state.dirty).toBe(true);

    const newest = roots(3);
    useRenderTree(newest);
    expect(api.getChildren).toHaveBeenCalledTimes(2);
    next.resolve(page(3, 9));
    await settle();
    const result = useRenderTree(newest);
    expect(
      pagesOf(result.loaded, 1)
        .get(0)
        ?.items.map((entry) => entry.id),
    ).toEqual([9]);
    expect(api.getChildren).toHaveBeenCalledTimes(2);
  });

  it("keeps and then refreshes a folder reopened while a revision batch was in flight", async () => {
    const pending = deferredPage();
    const refresh = deferredPage();
    vi.mocked(api.getChildren)
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(refresh.promise);
    hooks.state.values[0] = withPage(withPage(new Map(), 1, 0, page(0), 0), 1, 5, page(0, 8), 0);
    const current = roots(1);
    const result = useRenderTree(current);

    result.toggleFolder(1, 5);
    useRenderTree(current);
    expect(api.getChildren).toHaveBeenCalledTimes(1);
    pending.resolve(page(1));
    await settle();

    const loaded = pagesOf(hooks.state.values[0] as LoadedRoots, 1);
    expect(loaded.get(0)?.rev).toBe(1);
    expect(loaded.get(5)?.items.map((entry) => entry.id)).toEqual([8]);

    useRenderTree(current);
    expect(api.getChildren).toHaveBeenCalledTimes(2);
    expect(api.getChildren).toHaveBeenLastCalledWith(1, 5, 0, 200, order);
    expect(pagesOf(hooks.state.values[0] as LoadedRoots, 1).get(5)?.rev).toBe(0);
    refresh.resolve(page(1, 9));
    await settle();

    const updated = useRenderTree(current);
    expect(pagesOf(updated.loaded, 1).get(5)?.rev).toBe(1);
    expect(
      pagesOf(updated.loaded, 1)
        .get(5)
        ?.items.map((entry) => entry.id),
    ).toEqual([9]);
    expect(api.getChildren).toHaveBeenCalledTimes(2);
  });

  it("refreshes stale pages revealed after the current root revision already landed", async () => {
    const refresh = deferredPage();
    vi.mocked(api.getChildren).mockResolvedValueOnce(page(1)).mockReturnValueOnce(refresh.promise);
    const current = roots(1);
    useRenderTree(current);
    await settle();
    const updated = useRenderTree(current);
    expect(api.getChildren).toHaveBeenCalledTimes(1);

    updated.showPath(
      "C:",
      1,
      [
        { id: 0, name: "C:", rank: 0, size: 100 },
        { id: 5, name: "folder", rank: 0, size: 100 },
        { id: 8, name: "child", rank: 0, size: 100 },
      ],
      [{ id: 5, offset: 0, limit: 200 }],
      [page(0, 8)],
    );
    useRenderTree(current);

    expect(api.getChildren).toHaveBeenCalledTimes(2);
    expect(api.getChildren).toHaveBeenLastCalledWith(1, 5, 0, 200, order);
    refresh.resolve(page(1, 9));
    await settle();
    expect(pagesOf(useRenderTree(current).loaded, 1).get(5)?.rev).toBe(1);
    expect(api.getChildren).toHaveBeenCalledTimes(2);
  });

  it("still drops outdated folders that remained closed", async () => {
    vi.mocked(api.getChildren).mockResolvedValue(page(1));
    hooks.state.values[0] = withPage(withPage(new Map(), 1, 0, page(0), 0), 1, 5, page(0, 8), 0);

    useRenderTree(roots(1));
    await settle();

    expect(pagesOf(hooks.state.values[0] as LoadedRoots, 1).has(5)).toBe(false);
  });

  it("schedules the newer revision even if the initial batch failed without changing pages", async () => {
    const first = deferredPage();
    const next = deferredPage();
    vi.mocked(api.getChildren).mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    useRenderTree(roots(1));
    useRenderTree(roots(2));

    first.reject({ code: "StaleId" });
    await settle();
    expect(hooks.state.dirty).toBe(true);
    useRenderTree(roots(2));

    expect(api.getChildren).toHaveBeenCalledTimes(2);
    expect(onFail).not.toHaveBeenCalled();
  });
});

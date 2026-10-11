import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Item, ListOrder } from "../../api/types";
import { mark, noMarks } from "./marks";
import { PAGE_SIZE } from "./pages";
import { useCursor } from "./useCursor";
import type { Listing } from "./useRowPages";
import { useRowPosition } from "./useRowPosition";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateAt: 0,
  refAt: 0,
  effectAt: 0,
}));

// Commit and clean up real hook callbacks without a DOM or renderer dependency.
vi.mock("react", () => {
  const effect = (callback: () => (() => void) | void, deps: readonly unknown[]) => {
    const at = hooks.effectAt++;
    const old = hooks.effects[at];
    if (old && deps.every((dep, i) => Object.is(dep, old.deps[i]))) return;
    hooks.queued.push(() => {
      old?.cleanup?.();
      hooks.effects[at] = { deps, cleanup: callback() ?? undefined };
    });
  };
  return {
    useMemo: (calculate: () => unknown) => calculate(),
    useRef: (value: unknown) => (hooks.refs[hooks.refAt++] ??= { current: value }),
    useState: (initial: unknown) => {
      const at = hooks.stateAt++;
      if (!(at in hooks.values)) hooks.values[at] = initial;
      return [hooks.values[at], (next: unknown) => (hooks.values[at] = next)];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
});
vi.mock("../../api/client", () => ({ api: { getPosition: vi.fn() } }));

const order: ListOrder = { key: "size", descending: true, dirsOnly: false };
const onFail = vi.fn();
const body = { current: null };
const listing = (rev: number, ids: number[], page = 0): Listing => ({
  key: `0:${rev}:size:true:false`,
  orderKey: "0:size:true:false",
  total: PAGE_SIZE * 3,
  size: 100,
  pages: new Map([[page, ids.map((id) => ({ id }) as Item)]]),
});
let marks = noMarks("live");

function beginRender() {
  hooks.stateAt = hooks.refAt = hooks.effectAt = 0;
}

function commit() {
  hooks.queued.splice(0).forEach((run) => run());
}

function useRenderSelection(rows: Listing | null, listKey = "live", selectedId = 0) {
  beginRender();
  const shared = { generation: 1, listKey, order, listing: rows, live: true, onFail };
  const cursor = useCursor({
    ...shared,
    folder: 0,
    selectedId,
    count: rows?.total ?? 0,
    body,
  });
  const anchor = useRowPosition({ ...shared, index: marks.anchor, id: marks.anchorId });
  commit();
  return { ...cursor, anchor };
}

beforeEach(() => {
  hooks.effects.forEach((effect) => effect.cleanup?.());
  hooks.values = [];
  hooks.refs = [];
  hooks.effects = [];
  hooks.queued = [];
  marks = noMarks("live");
  vi.clearAllMocks();
});

describe("live table cursor and range anchor", () => {
  it("keeps both on their item as loaded rows reorder across multiple ticks", () => {
    useRenderSelection(listing(1, [10, 20, 30])).setCursor(0);
    marks = mark(marks, "one", 0, (index) => [10, 20, 30][index]);

    const next = useRenderSelection(listing(2, [20, 10, 30]));
    expect(next.cursor).toBe(1);
    expect(next.anchor).toBe(1);
    const later = useRenderSelection(listing(3, [30, 20, 10]));
    expect(later.cursor).toBe(2);
    expect(later.anchor).toBe(2);
    const range = mark({ ...marks, anchor: later.anchor }, "range", 1, (i) => [30, 20, 10][i]);
    expect([...range.ids]).toEqual([20, 10]);
    expect(range.anchorId).toBe(10);
    expect(api.getPosition).not.toHaveBeenCalled();
  });

  it("finds both by id when the item moves outside loaded pages", async () => {
    vi.mocked(api.getPosition).mockResolvedValue(PAGE_SIZE + 7);
    useRenderSelection(listing(1, [10, 20])).setCursor(0);
    marks = mark(marks, "one", 0, () => 10);
    const rows = listing(2, [20]);

    expect(useRenderSelection(rows)).toMatchObject({ cursor: null, anchor: null });
    await Promise.resolve();
    expect(useRenderSelection(rows)).toMatchObject({
      cursor: PAGE_SIZE + 7,
      anchor: PAGE_SIZE + 7,
    });
    expect(api.getPosition).toHaveBeenCalledWith(1, 10, order);
    expect(api.getPosition).toHaveBeenCalledTimes(1);
  });

  it("keeps the last position across page gaps and live ticks, sharing pending lookups", async () => {
    const finishes: ((position: number | null) => void)[] = [];
    vi.mocked(api.getPosition).mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    const initial = listing(1, [11, 12, 13, 14, 15, 16, 17, 10], 1);
    useRenderSelection(initial).setCursor(PAGE_SIZE + 7);
    marks = mark(marks, "one", PAGE_SIZE + 7, () => 10);
    expect(useRenderSelection(initial)).toMatchObject({
      cursor: PAGE_SIZE + 7,
      anchor: PAGE_SIZE + 7,
    });

    expect(useRenderSelection(null)).toMatchObject({
      cursor: PAGE_SIZE + 7,
      anchor: PAGE_SIZE + 7,
    });
    expect(api.getPosition).not.toHaveBeenCalled();
    expect(useRenderSelection(listing(2, [20]))).toMatchObject({
      cursor: PAGE_SIZE + 7,
      anchor: PAGE_SIZE + 7,
    });
    const rows = listing(3, [30]);
    expect(useRenderSelection(rows)).toMatchObject({
      cursor: PAGE_SIZE + 7,
      anchor: PAGE_SIZE + 7,
    });
    expect(api.getPosition).toHaveBeenCalledExactlyOnceWith(1, 10, order);

    finishes[0](PAGE_SIZE * 2 + 9);
    await Promise.resolve();
    expect(useRenderSelection(rows)).toMatchObject({
      cursor: PAGE_SIZE * 2 + 9,
      anchor: PAGE_SIZE * 2 + 9,
    });

    const next = listing(4, [40]);
    expect(useRenderSelection(next)).toMatchObject({
      cursor: PAGE_SIZE * 2 + 9,
      anchor: PAGE_SIZE * 2 + 9,
    });
    expect(api.getPosition).toHaveBeenCalledTimes(2);
    finishes[1](PAGE_SIZE * 2 + 12);
    await Promise.resolve();
    expect(useRenderSelection(next)).toMatchObject({
      cursor: PAGE_SIZE * 2 + 12,
      anchor: PAGE_SIZE * 2 + 12,
    });

    // A real null answer replaces the held position; waiting for an answer never does.
    const last = listing(5, [50]);
    expect(useRenderSelection(last).anchor).toBe(PAGE_SIZE * 2 + 12);
    finishes[2](null);
    await Promise.resolve();
    expect(useRenderSelection(last)).toMatchObject({ cursor: null, anchor: null });
  });

  it("ignores a delayed position after the cursor and anchor move to another item", async () => {
    const finishes: ((position: number) => void)[] = [];
    vi.mocked(api.getPosition).mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    useRenderSelection(listing(1, [10])).setCursor(0);
    marks = mark(marks, "one", 0, () => 10);
    const rows = listing(2, [20, 30]);
    const pending = useRenderSelection(rows);
    expect(pending.cursor).toBeNull();
    pending.setCursor(1);
    marks = mark(marks, "one", 1, () => 30);
    expect(useRenderSelection(rows)).toMatchObject({ cursor: 1, anchor: 1 });

    finishes.forEach((finish) => finish(100));
    await Promise.resolve();
    expect(useRenderSelection(rows)).toMatchObject({ cursor: 1, anchor: 1 });
    expect(onFail).not.toHaveBeenCalled();
  });

  it("keeps a picked position when its page disappears before the next render", async () => {
    let finish!: (position: number) => void;
    vi.mocked(api.getPosition).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    useRenderSelection(listing(1, [10], 1)).setCursor(PAGE_SIZE);
    marks = mark(marks, "one", PAGE_SIZE, () => 10);
    const rows = listing(2, [20]);
    expect(useRenderSelection(rows)).toMatchObject({ cursor: PAGE_SIZE, anchor: PAGE_SIZE });
    expect(api.getPosition).toHaveBeenCalledTimes(1);

    finish(PAGE_SIZE + 1);
    await Promise.resolve();
    expect(useRenderSelection(rows)).toMatchObject({
      cursor: PAGE_SIZE + 1,
      anchor: PAGE_SIZE + 1,
    });
  });

  it("does not move the cursor onto another loaded item when a position answer runs ahead", async () => {
    vi.mocked(api.getPosition).mockResolvedValue(0);
    useRenderSelection(listing(1, [10])).setCursor(0);
    const rows = listing(2, [20]);
    useRenderSelection(rows);
    await Promise.resolve();
    expect(useRenderSelection(rows).cursor).toBeNull();
  });

  it("drops the cursor when the folder or order changes", () => {
    useRenderSelection(listing(1, [10])).setCursor(0);
    expect(useRenderSelection(listing(2, [20, 10]), "other folder").cursor).toBeNull();
  });

  it("keeps a file picked in the table attached to its id after a live tick", () => {
    const picked = useRenderSelection(listing(1, [10, 20]));
    picked.setCursor(0);
    picked.pickedFile(10);
    expect(useRenderSelection(listing(2, [20, 10]), "live", 10).cursor).toBe(1);
    expect(api.getPosition).not.toHaveBeenCalled();
  });
});

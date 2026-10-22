import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildrenPage, Item, ListOrder } from "../../api/types";
import { api } from "../../api/client";
import { useRowPages, type Listing } from "./useRowPages";

const state = vi.hoisted(() => ({
  listing: null as Listing | null,
  cleanup: undefined as (() => void) | undefined,
}));

// Exercise the hook's async request callbacks without a DOM or a renderer dependency.
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
  useLayoutEffect: (effect: () => () => void) => {
    state.cleanup = effect();
  },
  useState: () => [
    state.listing,
    (update: (previous: Listing | null) => Listing) => {
      state.listing = update(state.listing);
    },
  ],
}));
vi.mock("../../api/client", () => ({ api: { getChildren: vi.fn() } }));

const order: ListOrder = { key: "size", descending: true, dirsOnly: false };
const first = { id: 10, size: 200 } as Item;
const second = { id: 20, size: 100 } as Item;

function answer(rev: number, items: Item[]): ChildrenPage {
  return {
    generation: 1,
    rev,
    approximate: false,
    size: 300,
    total: 400,
    restCount: 0,
    restSize: 0,
    items,
    baselineAt: null,
    baselineRev: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.listing = {
    key: "0:3.0:size:true:false",
    orderKey: "0:size:true:false",
    total: 400,
    size: 300,
    pages: new Map([[0, [first]]]),
  };
  state.cleanup = undefined;
});

describe("useRowPages", () => {
  it("refreshes instead of merging a newer page into a size-ordered listing", async () => {
    // The first item moved across the page boundary since revision 3: merging
    // revision 4 here would duplicate it and leave the displaced row missing.
    vi.mocked(api.getChildren).mockResolvedValue(answer(4, [first]));
    const onFail = vi.fn();
    const { request } = useRowPages(1, 3, 0, 0, order, onFail);
    const held = state.listing;

    request([1]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(state.listing).toBe(held);
    expect(state.listing?.pages.has(1)).toBe(false);
    expect(onFail).toHaveBeenCalledExactlyOnceWith({ code: "StaleId" });
  });

  it("merges another page from the held revision without refreshing", async () => {
    vi.mocked(api.getChildren).mockResolvedValue(answer(3, [second]));
    const onFail = vi.fn();
    const { request } = useRowPages(1, 3, 0, 0, order, onFail);

    request([1]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(state.listing?.pages.get(0)).toEqual([first]);
    expect(state.listing?.pages.get(1)).toEqual([second]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it.each(["name", "size"] as const)(
    "fills a newly scrolled %s page while the live backend revision runs ahead",
    async (key) => {
      vi.mocked(api.getChildren).mockResolvedValue(answer(7, [second]));
      const onFail = vi.fn();
      const liveOrder = { ...order, key };
      state.listing!.key = `0:3.0:${key}:true:false`;
      const { request } = useRowPages(1, 3, 0, 0, liveOrder, onFail, true);

      request([1]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(state.listing?.pages.get(0)).toEqual([first]);
      expect(state.listing?.pages.get(1)).toEqual([second]);
      expect(onFail).not.toHaveBeenCalled();
    },
  );

  it("refreshes instead of merging a newer name-ordered page outside a live scan", async () => {
    vi.mocked(api.getChildren).mockResolvedValue(answer(4, [second]));
    const onFail = vi.fn();
    state.listing!.key = "0:3.0:name:true:false";
    const { request } = useRowPages(1, 3, 0, 0, { ...order, key: "name" }, onFail);
    const held = state.listing;

    request([1]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(state.listing).toBe(held);
    expect(state.listing?.pages.has(1)).toBe(false);
    expect(onFail).toHaveBeenCalledExactlyOnceWith({ code: "StaleId" });
  });

  it("lists again, the old rows shown meanwhile, when the baseline changes", () => {
    const held = state.listing;
    const pages = useRowPages(1, 3, 1, 0, order, vi.fn());

    expect(pages.listing).toBeNull();
    expect(pages.previous).toBe(held);
  });

  it("ignores a newer page after its listing scope was disposed", async () => {
    vi.mocked(api.getChildren).mockResolvedValue(answer(4, [first]));
    const onFail = vi.fn();
    const { request } = useRowPages(1, 3, 0, 0, order, onFail);
    const held = state.listing;

    request([1]);
    state.cleanup?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(state.listing).toBe(held);
    expect(onFail).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary } from "../api/types";
import { useRootRefresh } from "./useRootRefresh";

const state = vi.hoisted(() => ({ roots: null as unknown }));

// One hook instance, called once: its refresh outlives the render, as in the app.
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void) => void effect(),
  useState: (initial: unknown) => {
    state.roots = initial;
    return [initial, (next: unknown) => (state.roots = next)];
  },
}));
vi.mock("../api/client", () => ({ api: { listRoots: vi.fn() } }));

const summary = (rev: number): Summary => ({
  generation: 1,
  rev,
  rootId: 0,
  root: "/root",
  total: 10,
  files: 1,
  len: 10,
  dirs: 1,
  scannedAt: 1,
  sizeMode: "Allocated",
  accessErrors: 0,
  approximate: false,
  volume: null,
  scanning: true,
});
const snapshot = (rev: number): Roots => ({ roots: [summary(rev)], queue: [] });
const shownRev = () => (state.roots as Roots).roots[0]?.rev;

beforeEach(() => vi.clearAllMocks());

describe("useRootRefresh", () => {
  it("applies a trash at once even when a paced refresh overtakes the immediate one", async () => {
    const { refresh } = useRootRefresh(vi.fn());
    vi.mocked(api.listRoots).mockResolvedValue(snapshot(5));
    await refresh();
    expect(shownRev()).toBe(5);

    // The trash command emits roots-changed too: that paced refresh may start after the
    // immediate one and supersede its answer.
    vi.mocked(api.listRoots).mockResolvedValue(snapshot(8));
    const now = refresh(true);
    const paced = refresh();
    await Promise.all([now, paced]);
    expect(shownRev()).toBe(8);
  });

  it("keeps pacing live revisions nobody asked to see at once", async () => {
    const { refresh } = useRootRefresh(vi.fn());
    vi.mocked(api.listRoots).mockResolvedValue(snapshot(5));
    await refresh();
    vi.mocked(api.listRoots).mockResolvedValue(snapshot(8));
    await refresh();
    expect(shownRev()).toBe(5);
  });
});

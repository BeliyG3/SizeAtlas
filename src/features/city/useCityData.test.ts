import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Crumb } from "../../api/types";
import { rt } from "../lists/hookRuntime";
import { focusIn } from "./world/buildings";
import { POLY } from "./world/map";
import { encodeCity, mapOf, square } from "./world/map.fixture";
import { useCityData } from "./useCityData";

vi.mock("react", async () => (await import("../lists/hookRuntime")).rt.hooks);
vi.mock("./world/buildings", async (original) => {
  const buildings = await original<typeof import("./world/buildings")>();
  return { ...buildings, focusIn: vi.fn(buildings.focusIn) };
});
vi.mock("../../api/client", () => ({ api: { getCity: vi.fn(), getCrumbs: vi.fn() } }));

/**
 * A city answer: district 1 with blocks 10 and 20, and in each block one house (`houses`
 * gives their ids, block 10's first).
 */
function city(generation: number, rev: number, houses = [11, 21]): ArrayBuffer {
  const map = mapOf(
    [
      square(POLY.district, 1, 0, 300, 0, 0, 100),
      square(POLY.block, 10, 1, 150, 0, 0, 50),
      square(POLY.block, 20, 1, 150, 50, 0, 50),
      square(POLY.house, houses[0], 10, 100, 10, 10, 20),
      square(POLY.house, houses[1], 20, 100, 60, 10, 20),
    ],
    { generation, rev },
  );
  return encodeCity(map);
}

const crumbs = (ids: number[]): Crumb[] =>
  ids.map((id) => ({ id, name: `n${id}`, size: 1, rank: 0 }));

/** Answers that the test releases in any order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const onFail = vi.fn();
let shown: ReturnType<typeof useCityData>;
// Called like a component, as React would: the hooks run in the same order every pass.
const Shell = (...args: Parameters<typeof useCityData>) => useCityData(...args);

function render(generation: number, rev: number, selectedId: number) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = Shell(generation, rev, selectedId, onFail);
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the hook never settled");
}

async function settle(generation: number, rev: number, selectedId: number) {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  render(generation, rev, selectedId);
}

const ids = () => shown.world?.buildings.map((b) => b.id);

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(api.getCity).mockImplementation((g) => Promise.resolve(city(g, 1)));
  vi.mocked(api.getCrumbs).mockResolvedValue(crumbs([0]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCityData", () => {
  it("asks once per generation and revision, not when only the selection changes", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    expect(ids()).toEqual([11, 21]);
    render(1, 1, 11);
    await settle(1, 1, 11);
    expect(api.getCity).toHaveBeenCalledTimes(1);
    expect(api.getCity).toHaveBeenCalledWith(1);
  });

  it("a new revision rebuilds the world", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    const first = shown.world;
    vi.mocked(api.getCity).mockImplementation((g) => Promise.resolve(city(g, 3, [12, 22])));
    render(1, 2, 0);
    await vi.advanceTimersByTimeAsync(1000);
    render(1, 3, 0);
    await vi.advanceTimersByTimeAsync(3999);
    render(1, 3, 0);
    expect(api.getCity).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    render(1, 3, 0);
    expect(api.getCity).toHaveBeenCalledTimes(2);
    await settle(1, 3, 0);
    expect(shown.world).not.toBe(first);
    expect(ids()).toEqual([12, 22]);
    // Nothing more is asked once the last revision has its answer.
    await vi.advanceTimersByTimeAsync(10_000);
    render(1, 3, 0);
    expect(api.getCity).toHaveBeenCalledTimes(2);
  });

  it("asks at once for a revision after a quiet spell", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    await vi.advanceTimersByTimeAsync(6000);
    render(1, 2, 0);
    await vi.advanceTimersByTimeAsync(0);
    render(1, 2, 0);
    expect(api.getCity).toHaveBeenCalledTimes(2);
  });

  it("drops an answer to an older revision that arrives late", async () => {
    const old = deferred<ArrayBuffer>();
    vi.mocked(api.getCity)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(city(1, 2, [12, 22]));
    render(1, 1, 0);
    render(1, 2, 0);
    await vi.advanceTimersByTimeAsync(5000);
    render(1, 2, 0);
    await settle(1, 2, 0);
    old.resolve(city(1, 1));
    await settle(1, 2, 0);
    expect(ids()).toEqual([12, 22]);
  });

  it("shows nothing of the old root once the generation changes", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    vi.mocked(api.getCity).mockReturnValue(new Promise(() => {}));
    render(2, 1, 0);
    expect(shown.world).toBeNull();
    expect(shown.finish).toBeNull();
    // A new root is asked for at once, whatever the pause of the old one.
    expect(api.getCity).toHaveBeenLastCalledWith(2);
  });

  it("dims around the selected folder's deepest laid-out ancestor", async () => {
    vi.mocked(api.getCrumbs).mockResolvedValue(crumbs([0, 1, 10, 99]));
    render(1, 1, 99);
    await settle(1, 1, 99);
    expect(api.getCrumbs).toHaveBeenCalledWith(1, 99);
    expect(focusIn).toHaveBeenLastCalledWith(expect.anything(), [0, 1, 10, 99], 0);
    expect(shown.world?.focusBox).not.toBeNull();
    // Block 10 is lit, block 20 beside it is dimmed.
    expect(shown.world?.buildings.map((b) => b.dim)).toEqual([false, true]);
  });

  it("passes a failed request on", async () => {
    vi.mocked(api.getCity).mockRejectedValue(new Error("gone"));
    render(1, 1, 0);
    await settle(1, 1, 0);
    expect(onFail).toHaveBeenCalledWith(new Error("gone"));
  });

  it("passes a response that does not parse on", async () => {
    vi.mocked(api.getCity).mockResolvedValue(new ArrayBuffer(3));
    render(1, 1, 0);
    await settle(1, 1, 0);
    expect(onFail).toHaveBeenCalledWith(new Error("city response is too short"));
    expect(shown.world).toBeNull();
  });

  it("finds the focus once per city and selection, not on every render", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    const calls = vi.mocked(focusIn).mock.calls.length;
    render(1, 1, 0);
    render(1, 1, 0);
    expect(vi.mocked(focusIn).mock.calls.length).toBe(calls);
  });
});

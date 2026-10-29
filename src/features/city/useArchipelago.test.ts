import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Archipelago, Crumb } from "../../api/types";
import { rt } from "../lists/hookRuntime";
import { focusIn } from "./world/buildings";
import { POLY } from "./world/map";
import { encodeCity, mapOf, square } from "./world/map.fixture";
import { REFRESH_MS, useArchipelago } from "./useArchipelago";

vi.mock("react", async () => (await import("../lists/hookRuntime")).rt.hooks);
vi.mock("./world/buildings", async (original) => {
  const buildings = await original<typeof import("./world/buildings")>();
  return { ...buildings, focusIn: vi.fn(buildings.focusIn) };
});
vi.mock("../../api/client", () => ({
  api: { getArchipelago: vi.fn(), getCity: vi.fn(), getCrumbs: vi.fn() },
}));

/** An island: district 1 with blocks 10 and 20, and in each block one house (11 and 21). */
function city(generation: number, rev: number): ArrayBuffer {
  return encodeCity(
    mapOf(
      [
        square(POLY.district, 1, 0, 300, 0, 0, 100),
        square(POLY.block, 10, 1, 150, 0, 0, 50),
        square(POLY.block, 20, 1, 150, 50, 0, 50),
        square(POLY.house, 11, 10, 100, 10, 10, 20),
        square(POLY.house, 21, 20, 100, 60, 10, 20),
      ],
      { generation, rev },
    ),
  );
}

/** The revision each open root is at, as the backend has it; the tests move it. */
const revs = new Map<number, number>();

function archipelago(): Archipelago {
  return {
    islands: [...revs.keys()].map((generation, i) => ({
      generation,
      rev: revs.get(generation)!,
      root: `/r${generation}`,
      x: i * 300,
      z: 0,
    })),
    bridges: [],
  };
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
let shown: ReturnType<typeof useArchipelago>;
// Called like a component, as React would: the hooks run in the same order every pass.
const Shell = (...args: Parameters<typeof useArchipelago>) => useArchipelago(...args);

/** The roots at the revisions in `revs`, `selected` among them. */
function render(selected = 1, id = 0) {
  const roots = [...revs].map(([generation, rev]) => ({ generation, rev }));
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = Shell(roots, { generation: selected, id }, onFail);
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the hook never settled");
}

async function settle(selected = 1, id = 0) {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  render(selected, id);
}

const houses = () => shown.world?.buildings.map((b) => [b.island, b.id]);

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
  revs.clear();
  revs.set(1, 1).set(2, 1);
  vi.mocked(api.getArchipelago).mockImplementation(() => Promise.resolve(archipelago()));
  vi.mocked(api.getCity).mockImplementation((g) => Promise.resolve(city(g, revs.get(g)!)));
  vi.mocked(api.getCrumbs).mockResolvedValue(crumbs([0]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useArchipelago", () => {
  it("shows every island of the archipelago, asked once per set of roots", async () => {
    render();
    await settle();
    expect(houses()).toEqual([
      [0, 11],
      [0, 21],
      [1, 11],
      [1, 21],
    ]);
    expect(shown.islands.map((i) => i.generation)).toEqual([1, 2]);
    expect(shown.selectedIsland).toBe(0);
    expect(shown.finish).not.toBeNull();
    // Only the selection moves: nothing is asked again.
    render(1, 11);
    await settle(1, 11);
    expect(api.getArchipelago).toHaveBeenCalledTimes(1);
    expect(api.getCity).toHaveBeenCalledTimes(2);
    expect(shown.selectedIsland).toBe(0);
    render(2, 0);
    expect(shown.selectedIsland).toBe(1);
  });

  it("asks at once when the set of roots changes, whatever the pause", async () => {
    revs.delete(2);
    render();
    await settle();
    expect(shown.islands).toHaveLength(1);
    revs.set(2, 1);
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
    await settle();
    expect(shown.islands).toHaveLength(2);
  });

  it("asks for a new revision at most once per pause, and only for the island that changed", async () => {
    render();
    await settle();
    revs.set(2, 2);
    render();
    await vi.advanceTimersByTimeAsync(1000);
    revs.set(2, 3);
    render();
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1001);
    render();
    expect(api.getArchipelago).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    render();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
    await settle();
    // Island 1 comes from the bytes already read; island 2 is read at its latest revision.
    expect(vi.mocked(api.getCity).mock.calls.map(([g]) => g)).toEqual([1, 2, 2]);
    expect(shown.world?.map.rev).toBe(1);
    // Nothing more is asked once the last revision has its answer.
    await vi.advanceTimersByTimeAsync(10_000);
    render();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
  });

  it("asks at once for a revision after a quiet spell", async () => {
    render();
    await settle();
    await vi.advanceTimersByTimeAsync(6000);
    revs.set(1, 2);
    render();
    await vi.advanceTimersByTimeAsync(0);
    render();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that arrives after a newer request", async () => {
    const old = deferred<ArrayBuffer>();
    vi.mocked(api.getCity).mockReturnValueOnce(old.promise);
    render();
    revs.set(1, 2);
    render();
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    render();
    await settle();
    expect(shown.world?.map.rev).toBe(2);
    old.resolve(city(1, 1));
    await settle();
    expect(shown.world?.map.rev).toBe(2);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("shows no island of a root closed while its bytes were on the way", async () => {
    const bytes = deferred<ArrayBuffer>();
    vi.mocked(api.getCity).mockImplementation((g) =>
      g === 2 ? bytes.promise : Promise.resolve(city(g, 1)),
    );
    render();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    revs.delete(2);
    render();
    bytes.resolve(city(2, 1));
    await settle();
    expect(shown.islands.map((i) => i.generation)).toEqual([1]);
    expect(houses()).toEqual([
      [0, 11],
      [0, 21],
    ]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("hides the picture of a closed root at once, before the new one is there", async () => {
    render();
    await settle();
    revs.delete(2);
    vi.mocked(api.getArchipelago).mockReturnValue(new Promise(() => {}));
    render();
    expect(shown.world).toBeNull();
    expect(shown.finish).toBeNull();
  });

  it("keeps the picture while another island is selected, and shows a lone root only once read", async () => {
    render();
    await settle();
    const before = shown.world;
    render(2, 0);
    expect(shown.world).toBe(before);
    expect(shown.selectedIsland).toBe(1);
    // A root that is no drive is not among the islands: nothing of the old view is shown for it.
    revs.set(3, 1);
    vi.mocked(api.getArchipelago).mockReturnValue(new Promise(() => {}));
    render(3, 0);
    expect(shown.world).toBeNull();
    expect(api.getArchipelago).toHaveBeenLastCalledWith(3);
  });

  it("reads again when an island was rebuilt between the two requests", async () => {
    vi.mocked(api.getArchipelago).mockImplementation(() => {
      revs.set(2, 2);
      return Promise.resolve(archipelago());
    });
    vi.mocked(api.getCity)
      .mockResolvedValueOnce(city(1, 1))
      .mockResolvedValueOnce(city(2, 1))
      .mockResolvedValueOnce(city(2, 2));
    render();
    await settle();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
    expect(shown.islands).toHaveLength(2);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("gives up with an error when an island keeps changing", async () => {
    vi.mocked(api.getCity).mockImplementation((g) => Promise.resolve(city(g, 99)));
    render();
    await settle();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(shown.world).toBeNull();
  });

  it("lights the selected folder's block on its own island only", async () => {
    vi.mocked(api.getCrumbs).mockResolvedValue(crumbs([0, 1, 10, 99]));
    render(2, 99);
    await settle(2, 99);
    expect(api.getCrumbs).toHaveBeenCalledWith(2, 99);
    expect(focusIn).toHaveBeenLastCalledWith(expect.anything(), [0, 1, 10, 99], 1);
    // Island 1 is dimmed whole; on island 2 block 10 is lit and block 20 dimmed.
    expect(shown.world?.buildings.map((b) => b.dim)).toEqual([true, true, false, true]);
  });

  it("passes a failed request on", async () => {
    vi.mocked(api.getArchipelago).mockRejectedValue(new Error("gone"));
    render();
    await settle();
    expect(onFail).toHaveBeenCalledWith(new Error("gone"));
  });

  it("passes a response that does not parse on", async () => {
    vi.mocked(api.getCity).mockResolvedValue(new ArrayBuffer(3));
    render();
    await settle();
    expect(onFail).toHaveBeenCalledWith(new Error("city response is too short"));
    expect(shown.world).toBeNull();
  });

  it("finds the focus once per picture and selection, not on every render", async () => {
    render();
    await settle();
    const calls = vi.mocked(focusIn).mock.calls.length;
    render();
    render();
    expect(vi.mocked(focusIn).mock.calls.length).toBe(calls);
  });
});

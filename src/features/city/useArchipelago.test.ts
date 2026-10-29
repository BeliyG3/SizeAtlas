import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Archipelago, Crumb } from "../../api/types";
import { rt } from "../lists/hookRuntime";
import { beginRefresh } from "../scan/cadence";
import { focusIn } from "./world/buildings";
import { POLY } from "./world/map";
import { encodeCity, mapOf, square } from "./world/map.fixture";
import { REFRESH_MS, useArchipelago } from "./useArchipelago";

vi.mock("react", async () => (await import("../lists/hookRuntime")).rt.hooks);
vi.mock("./world/buildings", async (original) => {
  const buildings = await original<typeof import("./world/buildings")>();
  return { ...buildings, focusIn: vi.fn(buildings.focusIn) };
});
// No refresh cost is booked: one booked under fake timers would slow the later tests.
vi.mock("../scan/cadence", async (original) => ({
  ...(await original<typeof import("../scan/cadence")>()),
  beginRefresh: vi.fn(() => () => {}),
}));
vi.mock("../../api/client", async (original) => ({
  ...(await original<typeof import("../../api/client")>()),
  api: { getArchipelago: vi.fn(), getCity: vi.fn(), getCrumbs: vi.fn() },
}));

/**
 * An island: district 1 with blocks 10 and 20, and in each block one house (11 and 21); a build
 * after the first has one house more (100 + build), as it has other gates in the real thing.
 */
function city(generation: number, rev: number, build = builds.get(generation) ?? 0): ArrayBuffer {
  const extra = build > 0 ? [square(POLY.house, 100 + build, 10, 100, 30, 10, 10)] : [];
  return encodeCity(
    mapOf(
      [
        square(POLY.district, 1, 0, 300, 0, 0, 100),
        square(POLY.block, 10, 1, 150, 0, 0, 50),
        square(POLY.block, 20, 1, 150, 50, 0, 50),
        square(POLY.house, 11, 10, 100, 10, 10, 20),
        ...extra,
        square(POLY.house, 21, 20, 100, 60, 10, 20),
      ],
      { generation, rev, build },
    ),
  );
}

/** The revision each open root is at, as the backend has it; the tests move it. */
const revs = new Map<number, number>();
/** The build each island is at, as the backend has it: an island rebuilt for new neighbours. */
const builds = new Map<number, number>();
/** The open roots that are no drive: the archipelago has no island for them. */
const folders = new Set<number>();

function archipelago(selected: number): Archipelago {
  return {
    islands: [...revs.keys()]
      .filter((g) => (folders.has(selected) ? g === selected : !folders.has(g)))
      .map((generation, i) => ({
        generation,
        rev: revs.get(generation)!,
        build: builds.get(generation) ?? 0,
        root: `/r${generation}`,
        x: i * 300,
        z: 0,
      })),
    bridges: [],
  };
}

/** The bytes of build `build` of an island while it is the one the backend has, as `get_city`. */
const getCity = (generation: number, build: number) =>
  build === (builds.get(generation) ?? 0)
    ? Promise.resolve(city(generation, revs.get(generation)!))
    : Promise.reject({ code: "BuildGone" });

/** A new rev of an island's tree: the backend builds the island again, under a new build. */
function rebuild(generation: number, rev: number) {
  revs.set(generation, rev);
  builds.set(generation, (builds.get(generation) ?? 0) + 1);
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
  builds.clear();
  folders.clear();
  revs.set(1, 1).set(2, 1);
  vi.mocked(api.getArchipelago).mockImplementation((g) => Promise.resolve(archipelago(g)));
  vi.mocked(api.getCity).mockImplementation(getCity);
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
    await settle(2, 0);
    expect(shown.selectedIsland).toBe(1);
    // The selected root is an island already shown: the archipelago is the same.
    expect(api.getArchipelago).toHaveBeenCalledTimes(1);
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
    rebuild(2, 2);
    render();
    await vi.advanceTimersByTimeAsync(1000);
    rebuild(2, 3);
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
    rebuild(1, 2);
    render();
    await vi.advanceTimersByTimeAsync(0);
    render();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that arrives after a newer request", async () => {
    const old = deferred<ArrayBuffer>();
    vi.mocked(api.getCity).mockReturnValueOnce(old.promise);
    render();
    rebuild(1, 2);
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

  it("keeps the picture while another island is selected", async () => {
    render();
    await settle();
    const before = shown.world;
    render(2, 0);
    expect(shown.world).toBe(before);
    expect(shown.selectedIsland).toBe(1);
  });

  it("asks at once for a selected root that is no island, and shows nothing of the old view", async () => {
    revs.set(3, 1);
    folders.add(3);
    render();
    await settle();
    expect(shown.islands.map((i) => i.generation)).toEqual([1, 2]);
    expect(api.getArchipelago).toHaveBeenCalledTimes(1);
    vi.mocked(api.getArchipelago).mockReturnValue(new Promise(() => {}));
    render(3, 0);
    expect(shown.world).toBeNull();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
    expect(api.getArchipelago).toHaveBeenLastCalledWith(3);
  });

  it("ignores the revision of an open folder that is no island", async () => {
    revs.set(3, 1);
    folders.add(3);
    render();
    await settle();
    revs.set(3, 2);
    render();
    await vi.advanceTimersByTimeAsync(3 * REFRESH_MS);
    render();
    expect(api.getArchipelago).toHaveBeenCalledTimes(1);
    // The same folder, once it is the root shown, is followed.
    revs.set(3, 3);
    render(3, 0);
    await settle(3, 0);
    revs.set(3, 4);
    render(3, 0);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    render(3, 0);
    expect(api.getArchipelago).toHaveBeenCalledTimes(3);
  });

  it("releases the island of a closed root, and reads it again when it comes back", async () => {
    render();
    await settle();
    expect(vi.mocked(api.getCity).mock.calls.map(([g]) => g)).toEqual([1, 2]);
    revs.delete(2);
    render();
    await settle();
    expect(shown.islands).toHaveLength(1);
    revs.set(2, 1);
    render();
    await settle();
    expect(shown.islands).toHaveLength(2);
    expect(vi.mocked(api.getCity).mock.calls.map(([g]) => g)).toEqual([1, 2, 2]);
  });

  it("reads an island once for two requests that overlap", async () => {
    const bytes = deferred<ArrayBuffer>();
    vi.mocked(api.getCity).mockReturnValueOnce(bytes.promise);
    render();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    // A root opens while island 1 is still on the way: the new request needs it too.
    revs.set(3, 1);
    render();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    bytes.resolve(city(1, 1));
    await settle();
    const asked = vi.mocked(api.getCity).mock.calls.map(([g]) => g);
    expect(asked.filter((g) => g === 1)).toHaveLength(1);
    expect(shown.islands.map((i) => i.generation)).toEqual([1, 2, 3]);
  });

  it("reads an island again that was rebuilt under the same rev, and merges the new map", async () => {
    render();
    await settle();
    expect(vi.mocked(api.getCity).mock.calls.map(([g]) => g)).toEqual([1, 2]);
    // A third drive opens: island 1 is built again for its new neighbours, its tree unchanged.
    revs.set(3, 1);
    builds.set(1, 2);
    render();
    await settle();
    expect(vi.mocked(api.getCity).mock.calls.map(([g]) => g)).toEqual([1, 2, 1, 3]);
    expect(houses()).toContainEqual([0, 102]);
    expect(shown.islands.map((i) => i.build)).toEqual([2, 0, 0]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("asks the archipelago once more when an island's build is gone before it is read", async () => {
    // The archipelago names build 0 of island 2, which is rebuilt before its bytes are read.
    vi.mocked(api.getArchipelago).mockImplementationOnce((g) => {
      const named = archipelago(g);
      rebuild(2, 2);
      return Promise.resolve(named);
    });
    render();
    await settle();
    expect(api.getArchipelago).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.getCity).mock.calls).toEqual([
      [1, 0],
      [2, 0],
      [2, 1],
    ]);
    expect(shown.islands.map((i) => i.build)).toEqual([0, 1]);
    expect(houses()).toContainEqual([1, 101]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("passes a build gone twice on, asking the archipelago no more", async () => {
    render();
    await settle();
    const before = shown.world;
    vi.mocked(api.getCity).mockRejectedValue({ code: "BuildGone" });
    revs.set(3, 1);
    render();
    await settle();
    expect(api.getArchipelago).toHaveBeenCalledTimes(1 + 2);
    expect(onFail).toHaveBeenCalledExactlyOnceWith({ code: "BuildGone" });
    expect(shown.world).toBe(before);
  });

  it("books the refresh cost of a request that fails or is dropped", async () => {
    const failed = vi.fn();
    vi.mocked(beginRefresh).mockReturnValueOnce(failed);
    vi.mocked(api.getArchipelago).mockRejectedValueOnce(new Error("gone"));
    render();
    await settle();
    expect(failed).toHaveBeenCalledOnce();
    const dropped = vi.fn();
    vi.mocked(beginRefresh).mockReturnValueOnce(dropped);
    const answer = deferred<Archipelago>();
    vi.mocked(api.getArchipelago).mockReturnValueOnce(answer.promise);
    revs.set(3, 1);
    render();
    revs.delete(3);
    render();
    answer.resolve(archipelago(1));
    await settle();
    expect(dropped).toHaveBeenCalledOnce();
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

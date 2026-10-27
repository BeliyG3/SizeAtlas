import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Crumb } from "../../api/types";
import { rt } from "../lists/hookRuntime";
import { CITY_RECORD_LEN, HEADER_LEN } from "./bytes";
import { focusIn } from "./model";
import { useCityData } from "./useCityData";

vi.mock("react", async () => (await import("../lists/hookRuntime")).rt.hooks);
vi.mock("./model", async (original) => {
  const model = await original<typeof import("./model")>();
  return { ...model, focusIn: vi.fn(model.focusIn) };
});
vi.mock("../../api/client", () => ({ api: { getCity: vi.fn(), getCrumbs: vi.fn() } }));

/** A city answer with the given folders (ids), each a plate over the whole field. */
function city(generation: number, rev: number, dirs: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_LEN + dirs.length * CITY_RECORD_LEN);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(generation), true);
  view.setBigUint64(8, BigInt(rev), true);
  view.setUint32(16, dirs.length, true);
  dirs.forEach((id, i) => {
    const at = HEADER_LEN + i * CITY_RECORD_LEN;
    [0, 0, 1000, 1000].forEach((v, k) => view.setFloat32(at + k * 4, v, true));
    view.setUint32(at + 16, id, true);
    view.setUint8(at + 20, 255);
    view.setUint8(at + 21, i);
    view.setUint8(at + 22, 1);
    view.setUint8(at + 23, 1);
    view.setBigUint64(at + 24, 100n, true);
  });
  return buffer;
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

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.mocked(api.getCity).mockImplementation((g) => Promise.resolve(city(g, 1, [10, 11])));
  vi.mocked(api.getCrumbs).mockResolvedValue(crumbs([0]));
});

describe("useCityData", () => {
  it("asks once per generation and revision, not when only the selection changes", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    expect(shown.city?.blocks.map((b) => b.id)).toEqual([10, 11]);
    render(1, 1, 11);
    await settle(1, 1, 11);
    expect(api.getCity).toHaveBeenCalledTimes(1);
    expect(api.getCity).toHaveBeenCalledWith(1);
    render(1, 2, 11);
    expect(api.getCity).toHaveBeenCalledTimes(2);
  });

  it("drops an answer to an older revision that arrives late", async () => {
    const old = deferred<ArrayBuffer>();
    vi.mocked(api.getCity)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(city(1, 2, [20]));
    render(1, 1, 0);
    render(1, 2, 0);
    await settle(1, 2, 0);
    old.resolve(city(1, 1, [10]));
    await settle(1, 2, 0);
    expect(shown.city?.blocks.map((b) => b.id)).toEqual([20]);
  });

  it("shows nothing of the old root once the generation changes", async () => {
    render(1, 1, 0);
    await settle(1, 1, 0);
    vi.mocked(api.getCity).mockReturnValue(new Promise(() => {}));
    render(2, 1, 0);
    expect(shown.city).toBeNull();
    expect(api.getCity).toHaveBeenLastCalledWith(2);
  });

  it("dims around the selected folder's deepest laid-out ancestor", async () => {
    vi.mocked(api.getCrumbs).mockResolvedValue(crumbs([0, 10, 11, 99]));
    render(1, 1, 99);
    await settle(1, 1, 99);
    expect(api.getCrumbs).toHaveBeenCalledWith(1, 99);
    expect(shown.city?.focusBox).not.toBeNull();
  });

  it("passes a failed request on", async () => {
    vi.mocked(api.getCity).mockRejectedValue(new Error("gone"));
    render(1, 1, 0);
    await settle(1, 1, 0);
    expect(onFail).toHaveBeenCalledWith(new Error("gone"));
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

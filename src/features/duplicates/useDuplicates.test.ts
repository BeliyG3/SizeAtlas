import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, onDuplicatesStatus } from "../../api/client";
import type { DupScope, DupStatus } from "../../api/duplicates";
import { rt } from "../lists/hookRuntime";
import { answer, estimate, group, status } from "./dup.testSupport";
import { useDuplicates } from "./useDuplicates";

vi.mock("react", async () => (await import("../lists/hookRuntime")).rt.hooks);
vi.mock("../../api/client", () => ({
  api: {
    getDuplicates: vi.fn(),
    estimateDuplicates: vi.fn(),
    findDuplicates: vi.fn(),
    cancelDuplicates: vi.fn(),
    getCrumbs: vi.fn(),
  },
  onDuplicatesStatus: vi.fn(),
}));

const sent = vi.hoisted(() => ({ status: null as ((s: DupStatus) => void) | null }));
const onFail = vi.fn();
let shown: ReturnType<typeof useDuplicates>;
// Called like a component, as React would: the hooks run in the same order every pass.
const Shell = (props: Parameters<typeof useDuplicates>[0]) => useDuplicates(props);

/** Renders the hook until its state and effects settle, as React would. */
function render(rootsKey = "C:\\:1:3", query = "type:image", scope: DupScope | null = null) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = Shell({ query, system: false, scope, rootsKey, onFail });
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the hook never settled");
}

/** Lets the answers land, then renders again. */
async function settle(rootsKey?: string) {
  await Promise.resolve();
  await Promise.resolve();
  render(rootsKey);
}

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.mocked(onDuplicatesStatus).mockImplementation((cb) => {
    sent.status = cb;
    return Promise.resolve(() => {});
  });
  vi.mocked(api.estimateDuplicates).mockResolvedValue(estimate());
  vi.mocked(api.getCrumbs).mockImplementation((_, id) =>
    Promise.resolve([
      { id: 0, name: "C:\\", size: 0, rank: 0 },
      { id, name: `f${id}`, size: 0, rank: 0 },
    ]),
  );
  vi.mocked(api.getDuplicates).mockResolvedValue(
    answer({ job: 2, version: 5, complete: true, groups: [group("a")] }),
  );
});

describe("useDuplicates", () => {
  it("shows the kept result on mount and never starts a search by itself", async () => {
    render();
    expect(api.getDuplicates).toHaveBeenCalledWith(0, 0);
    await settle();
    expect(shown.state?.job).toBe(2);
    expect([...shown.state!.groups.keys()]).toEqual(["a"]);
    expect(shown.estimate).toEqual(estimate());
    expect(api.estimateDuplicates).toHaveBeenCalledWith("type:image", false, null);
    expect(api.findDuplicates).not.toHaveBeenCalled();
  });

  it("asks for nothing on a status of an older job", async () => {
    render();
    await settle();
    vi.mocked(api.getDuplicates).mockClear();
    sent.status!(status({ job: 1, version: 9 }));
    sent.status!(status({ job: 2, version: 5 }));
    await settle();
    expect(api.getDuplicates).not.toHaveBeenCalled();
    expect(shown.status?.job).toBe(2);
  });

  it("asks for what changed after its version when a newer one is sent", async () => {
    render();
    await settle();
    vi.mocked(api.getDuplicates).mockResolvedValue(
      answer({ job: 2, version: 7, running: true, full: false, groups: [group("b")] }),
    );
    sent.status!(status({ job: 2, version: 7, running: true }));
    expect(api.getDuplicates).toHaveBeenLastCalledWith(2, 5);
    await settle();
    expect([...shown.state!.groups.keys()].sort()).toEqual(["a", "b"]);
    expect(shown.status?.running).toBe(true);
  });

  it("keeps a stale mark of a version when an answer of it read before says otherwise", async () => {
    render();
    await settle();
    sent.status!(status({ job: 2, version: 5, stale: true }));
    render("C:\\:1:4");
    await settle("C:\\:1:4");
    expect(shown.status?.stale).toBe(true);
  });

  it("asks again when the roots change, so the stale mark follows them", async () => {
    render();
    await settle();
    vi.mocked(api.getDuplicates).mockClear();
    vi.mocked(api.estimateDuplicates).mockClear();
    render("C:\\:1:4");
    expect(api.getDuplicates).toHaveBeenCalledWith(2, 5);
    expect(api.estimateDuplicates).toHaveBeenCalledTimes(1);
  });

  it("starts a search for the words it is given and fetches its result", async () => {
    render();
    await settle();
    vi.mocked(api.findDuplicates).mockResolvedValue(3);
    shown.find("*.png");
    expect(api.findDuplicates).toHaveBeenCalledWith("*.png", false, null);
    await settle();
    expect(api.getDuplicates).toHaveBeenLastCalledWith(2, 5);
  });

  it("estimates again for another folder, and searches the folder only on Find", async () => {
    const a: DupScope = { root: "C:\\", generation: 1, folder: 4 };
    const b: DupScope = { root: "C:\\", generation: 1, folder: 9 };
    render(undefined, undefined, a);
    await Promise.resolve();
    expect(api.estimateDuplicates).toHaveBeenLastCalledWith("type:image", false, a);
    render(undefined, undefined, a);
    expect(api.estimateDuplicates).toHaveBeenCalledTimes(1);
    render(undefined, undefined, b);
    expect(api.estimateDuplicates).toHaveBeenCalledTimes(2);
    expect(api.estimateDuplicates).toHaveBeenLastCalledWith("type:image", false, b);
    expect(api.findDuplicates).not.toHaveBeenCalled();
    vi.mocked(api.findDuplicates).mockResolvedValue(3);
    shown.find("type:image");
    expect(api.findDuplicates).toHaveBeenCalledWith("type:image", false, b);
  });

  it("starts one search for a double click: Find waits for the first to be taken", async () => {
    render();
    await settle();
    let started!: (job: number) => void;
    vi.mocked(api.findDuplicates).mockReturnValue(new Promise((resolve) => (started = resolve)));
    shown.find("type:image");
    render();
    expect(shown.finding).toBe(true);
    shown.find("type:image");
    expect(api.findDuplicates).toHaveBeenCalledTimes(1);
    started(3);
    await settle();
    expect(shown.finding).toBe(false);
    vi.mocked(api.findDuplicates).mockResolvedValue(4);
    shown.find("type:image");
    expect(api.findDuplicates).toHaveBeenCalledTimes(2);
  });

  it("names the folder at once and dims the counts until its estimate lands", async () => {
    const a: DupScope = { root: "C:\\", generation: 1, folder: 4 };
    const b: DupScope = { root: "C:\\", generation: 1, folder: 9 };
    vi.mocked(api.estimateDuplicates).mockResolvedValueOnce(estimate({ scope: "C:\\f4" }));
    render(undefined, undefined, a);
    await Promise.resolve();
    await Promise.resolve();
    render(undefined, undefined, a);
    expect([shown.target, shown.estimating]).toEqual(["C:\\f4", false]);
    const later: ((e: ReturnType<typeof estimate>) => void)[] = [];
    vi.mocked(api.estimateDuplicates).mockImplementation(
      () => new Promise((resolve) => later.push(resolve)),
    );
    render(undefined, undefined, b);
    // The old counts are not the folder's: shown as on their way.
    expect(shown.estimating).toBe(true);
    expect(shown.estimate?.scope).toBe("C:\\f4");
    await Promise.resolve();
    render(undefined, undefined, b);
    expect(api.getCrumbs).toHaveBeenLastCalledWith(1, 9);
    expect([shown.target, shown.estimating]).toEqual(["C:\\f9", true]);
    later[0](estimate({ scope: "C:\\f9", files: 3 }));
    await Promise.resolve();
    render(undefined, undefined, b);
    expect([shown.target, shown.estimating, shown.estimate?.files]).toEqual(["C:\\f9", false, 3]);
  });

  it("drops an estimate of a folder no longer selected", async () => {
    const a: DupScope = { root: "C:\\", generation: 1, folder: 4 };
    const b: DupScope = { root: "C:\\", generation: 1, folder: 9 };
    const later: ((e: ReturnType<typeof estimate>) => void)[] = [];
    vi.mocked(api.estimateDuplicates).mockImplementation(
      () => new Promise((resolve) => later.push(resolve)),
    );
    render(undefined, undefined, a);
    render(undefined, undefined, b);
    later[0](estimate({ scope: "C:\\f4", files: 1 }));
    await Promise.resolve();
    render(undefined, undefined, b);
    expect(shown.estimate).toBeNull();
    expect(shown.target).toBe("C:\\f9");
    later[1](estimate({ scope: "C:\\f9", files: 2 }));
    await Promise.resolve();
    render(undefined, undefined, b);
    expect([shown.estimate?.files, shown.estimating]).toEqual([2, false]);
  });

  it("stops estimating and drops the old counts when an estimate fails", async () => {
    const a: DupScope = { root: "C:\\", generation: 1, folder: 4 };
    const b: DupScope = { root: "C:\\", generation: 1, folder: 9 };
    vi.mocked(api.estimateDuplicates).mockResolvedValueOnce(estimate({ scope: "C:\\f4" }));
    render(undefined, undefined, a);
    await Promise.resolve();
    await Promise.resolve();
    render(undefined, undefined, a);
    const error = new Error("walk failed");
    vi.mocked(api.estimateDuplicates).mockRejectedValueOnce(error);
    render(undefined, undefined, b);
    await Promise.resolve();
    await Promise.resolve();
    render(undefined, undefined, b);
    expect(onFail).toHaveBeenCalledWith(error);
    // No "…" forever, and no counts of the other folder.
    expect([shown.estimating, shown.estimate, shown.target]).toEqual([false, null, "C:\\f9"]);
  });

  it("names no folder for every open root", async () => {
    render();
    await settle();
    expect([shown.target, shown.estimating]).toEqual([null, false]);
    expect(api.getCrumbs).not.toHaveBeenCalled();
  });
});

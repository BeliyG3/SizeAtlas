import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, onDuplicatesStatus } from "../../api/client";
import type { DupStatus } from "../../api/duplicates";
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
  },
  onDuplicatesStatus: vi.fn(),
}));

const sent = vi.hoisted(() => ({ status: null as ((s: DupStatus) => void) | null }));
const onFail = vi.fn();
let shown: ReturnType<typeof useDuplicates>;
// Called like a component, as React would: the hooks run in the same order every pass.
const Shell = (props: Parameters<typeof useDuplicates>[0]) => useDuplicates(props);

/** Renders the hook until its state and effects settle, as React would. */
function render(rootsKey = "C:\\:1:3", query = "type:image") {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = Shell({ query, system: false, rootsKey, onFail });
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
});

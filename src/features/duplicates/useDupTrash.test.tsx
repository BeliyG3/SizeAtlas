import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { DupCopy } from "../../api/duplicates";
import type { Summary, TrashPreview, TrashResult } from "../../api/types";
import type { TrashDialog } from "../trash/TrashDialog";
import { rt } from "../lists/hookRuntime";
import { copy } from "./dup.testSupport";
import { useDupTrash } from "./useDupTrash";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({
  api: {
    trashPreview: vi.fn(),
    getSummary: vi.fn(),
    trashDuplicates: vi.fn(),
    trash: vi.fn(),
    deleteForGood: vi.fn(),
  },
  isCmdError: (e: unknown) => typeof e === "object" && e !== null && "code" in e,
}));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", () => ({ useSize: () => String }));
vi.mock("../trash/TrashDialog", () => ({ TrashDialog: () => null }));

const tree = (generation: number, rev: number) =>
  ({ root: `R${generation}`, summary: { generation, rev } as Summary }) as const;
const entries = [tree(1, 4), tree(2, 7)];
const preview = (count: number): TrashPreview => ({
  count,
  size: count,
  scannedAt: 1,
  paths: [`/p${count}`],
  binFree: null,
  binSize: 0,
});
const result: TrashResult = {
  removed: 2,
  gone: 0,
  size: 2,
  failed: [],
  stopped: false,
  cancelled: false,
  warning: null,
};

const runs = { start: vi.fn(() => 41), end: vi.fn(), pending: false };
const push = vi.fn();
const onError = vi.fn();
const refresh = vi.fn();
const onTrashed = vi.fn();
let running = false;
let removing: (generation: number, ids: readonly number[]) => boolean = () => false;
let shown: ReturnType<typeof useDupTrash>;
// Called like a component, as React would: the hooks run in the same order every pass.
const Shell = () =>
  useDupTrash({
    entries,
    runs,
    isRemoving: (g, ids) => removing(g, ids),
    push,
    errorText: String,
    onError,
    refresh,
    onTrashed,
    running,
  });

function render() {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = Shell();
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the hook never settled");
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  render();
};

const dialog = () => shown.dialog as ReactElement<Parameters<typeof TrashDialog>[0]> | null;

const one = copy(1, { refs: [{ root: "R1", generation: 1, id: 1 }] });
const other = copy(2, { refs: [{ root: "R2", generation: 2, id: 9 }] });

async function askAndConfirm(copies: readonly DupCopy[]) {
  render();
  shown.ask(copies);
  await settle();
  dialog()!.props.onConfirm();
  render();
}

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  removing = () => false;
  running = false;
  vi.mocked(api.trashPreview).mockImplementation((g, _rev, ids) =>
    Promise.resolve(preview(ids.length + g * 10)),
  );
  vi.mocked(api.trashDuplicates).mockResolvedValue(result);
});

describe("useDupTrash", () => {
  it("previews every tree, then sends one request of all the paths", async () => {
    await askAndConfirm([one, other]);
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [1]);
    expect(api.trashPreview).toHaveBeenCalledWith(2, 7, [9]);
    expect(dialog()).toBeNull();
    expect(runs.start).toHaveBeenCalledWith({
      generation: 1,
      root: "R1",
      ids: [1],
      preview: expect.objectContaining({ count: 32 }),
      purge: false,
      more: [{ generation: 2, root: "R2", ids: [9] }],
    });
    expect(api.trashDuplicates).toHaveBeenCalledWith(41, [...one.refs, ...other.refs]);
    expect(api.trash).not.toHaveBeenCalled();
    expect(api.deleteForGood).not.toHaveBeenCalled();
    await settle();
    expect(push).toHaveBeenCalledWith("trash.done");
    expect(onTrashed).toHaveBeenCalledOnce();
    expect(runs.end).toHaveBeenCalledWith(41);
    expect(refresh).toHaveBeenCalled();
  });

  it("takes every path of a file with two links", async () => {
    const linked = copy(1, {
      refs: [
        { root: "R1", generation: 1, id: 1 },
        { root: "R1", generation: 1, id: 5 },
      ],
    });
    await askAndConfirm([linked]);
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [1, 5]);
    expect(api.trashDuplicates).toHaveBeenCalledWith(41, linked.refs);
  });

  it("never sends again a request refused as out of date", async () => {
    vi.mocked(api.trashDuplicates).mockRejectedValue({ code: "StaleId" });
    await askAndConfirm([one]);
    await settle();
    expect(api.trashPreview).toHaveBeenCalledTimes(1);
    expect(api.trashDuplicates).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("trash.notRemoved");
    expect(onError).not.toHaveBeenCalled();
    expect(runs.end).toHaveBeenCalledWith(41);
    expect(refresh).toHaveBeenCalled();
  });

  it("tells of another refusal and says nothing of a request stopped while it waited", async () => {
    vi.mocked(api.trashDuplicates).mockRejectedValueOnce({ code: "LastCopy" });
    await askAndConfirm([one]);
    await settle();
    expect(onError).toHaveBeenCalledWith({ code: "LastCopy" });
    vi.mocked(api.trashDuplicates).mockResolvedValueOnce({ ...result, cancelled: true });
    push.mockClear();
    onTrashed.mockClear();
    await askAndConfirm([one]);
    await settle();
    expect(api.trashDuplicates).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    expect(onTrashed).not.toHaveBeenCalled();
  });

  it("does not ask for a copy a request has already", () => {
    removing = (g, ids) => g === 2 && ids.includes(9);
    render();
    shown.ask([one, other]);
    expect(push).toHaveBeenCalledWith("trash.already");
    expect(api.trashPreview).not.toHaveBeenCalled();
  });

  it("sends nothing when another request took a copy while the dialog was open", async () => {
    render();
    shown.ask([one]);
    await settle();
    removing = () => true;
    dialog()!.props.onConfirm();
    render();
    expect(push).toHaveBeenCalledWith("trash.already");
    expect(runs.start).not.toHaveBeenCalled();
    expect(api.trashDuplicates).not.toHaveBeenCalled();
  });

  it("previews again at the revision a tree has now when the view lagged behind it", async () => {
    vi.mocked(api.trashPreview).mockRejectedValueOnce({ code: "StaleId" });
    vi.mocked(api.getSummary).mockResolvedValue({ generation: 1, rev: 6 } as Summary);
    render();
    shown.ask([one]);
    await settle();
    expect(api.getSummary).toHaveBeenCalledWith(1);
    expect(api.trashPreview).toHaveBeenLastCalledWith(1, 6, [1]);
    expect(dialog()).not.toBeNull();
  });

  it("says nothing was removed when the tree closed while it was read again", async () => {
    vi.mocked(api.trashPreview).mockRejectedValueOnce({ code: "StaleId" });
    vi.mocked(api.getSummary).mockRejectedValue(new Error("no such tree"));
    render();
    shown.ask([one]);
    await settle();
    expect(push).toHaveBeenCalledWith("trash.notRemoved");
    expect(refresh).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("sends nothing when a search started while the dialog was open, and says why", async () => {
    render();
    shown.ask([one]);
    await settle();
    running = true;
    render();
    dialog()!.props.onConfirm();
    render();
    expect(push).toHaveBeenCalledWith("dup.searching");
    expect(runs.start).not.toHaveBeenCalled();
    expect(api.trashDuplicates).not.toHaveBeenCalled();
  });

  it("hands a report that fails to the error handler", async () => {
    push.mockImplementationOnce(() => {
      throw new Error("toast failed");
    });
    await askAndConfirm([one]);
    await settle();
    expect(onError).toHaveBeenCalledWith(new Error("toast failed"));
    expect(runs.end).toHaveBeenCalledWith(41);
  });
});

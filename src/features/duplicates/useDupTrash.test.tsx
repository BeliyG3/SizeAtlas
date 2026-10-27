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

const runs = { start: vi.fn(() => 41), end: vi.fn() };
const push = vi.fn();
const onError = vi.fn();
const refresh = vi.fn();
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
  for (let i = 0; i < 5; i++) await Promise.resolve();
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
    await askAndConfirm([one]);
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not ask for a copy a request has already", () => {
    removing = (g, ids) => g === 2 && ids.includes(9);
    render();
    shown.ask([one, other]);
    expect(push).toHaveBeenCalledWith("trash.already");
    expect(api.trashPreview).not.toHaveBeenCalled();
  });

  it("is trashing from the confirmation until the answer", async () => {
    let answer: (result: TrashResult) => void = () => {};
    vi.mocked(api.trashDuplicates).mockReturnValue(new Promise((done) => (answer = done)));
    render();
    expect(shown.trashing).toBe(false);
    await askAndConfirm([one]);
    expect(shown.trashing).toBe(true);
    answer(result);
    await settle();
    expect(shown.trashing).toBe(false);
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
});

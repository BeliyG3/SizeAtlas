import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary, TrashPreview, TrashResult } from "../api/types";
import { PurgeDialog } from "../features/trash/PurgeDialog";
import { TrashDialog } from "../features/trash/TrashDialog";
import { rootEntries } from "./roots";
import { useTrash } from "./useTrash";
import { useTrashRefused } from "./useTrashRefused";

const hooks = vi.hoisted(() => {
  const state = {
    values: [] as unknown[],
    refs: [] as { current: unknown }[],
    stateAt: 0,
    refAt: 0,
  };
  const beginRender = () => {
    state.stateAt = 0;
    state.refAt = 0;
  };
  return { state, beginRender };
});

// Keep state across explicit renders without mounting a DOM or a renderer.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const at = hooks.state.stateAt++;
    if (!(at in hooks.state.values)) hooks.state.values[at] = initial;
    return [
      hooks.state.values[at],
      (next: unknown) => {
        hooks.state.values[at] = typeof next === "function" ? next(hooks.state.values[at]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const at = hooks.state.refAt++;
    return (hooks.state.refs[at] ??= { current: initial });
  },
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (commit: () => void) => commit(),
  useEffect: (commit: () => void) => void commit(),
}));
vi.mock("../api/client", () => ({
  api: {
    trashPreview: vi.fn(),
    trash: vi.fn(),
    deleteForGood: vi.fn(),
    trashRefused: vi.fn(),
    cancelTrash: vi.fn(),
  },
  isCmdError: (e: unknown) => typeof e === "object" && e !== null && "code" in e,
  onTrashProgress: () => Promise.resolve(() => {}),
}));
vi.mock("../settings/react", () => ({ useSize: () => String }));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../features/trash/TrashDialog", () => ({ TrashDialog: () => null }));
vi.mock("../features/trash/PurgeDialog", () => ({ PurgeDialog: () => null }));

const summary = (scanning: boolean): Summary => ({
  root: "/root",
  rootId: 0,
  generation: 1,
  rev: 4,
  scanning,
  total: 10,
  files: 1,
  len: 10,
  dirs: 1,
  accessErrors: 0,
  approximate: false,
  scannedAt: 1,
  sizeMode: "Allocated",
  volume: null,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

function useRenderTrash(roots: Roots, id = 7, onError = vi.fn(), push = vi.fn()) {
  hooks.beginRender();
  return useTrash({
    roots,
    entries: rootEntries(roots),
    selection: { root: "/root", generation: 1, id, folder: id },
    push,
    onTrashed: () => {},
    onError,
    errorText: String,
  });
}

beforeEach(() => {
  hooks.state.values = [];
  hooks.state.refs = [];
  vi.clearAllMocks();
  vi.mocked(api.trashRefused).mockResolvedValue(true);
  vi.mocked(api.trashPreview).mockResolvedValue({
    count: 1,
    size: 10,
    scannedAt: 1,
    paths: ["/root/file"],
    binSize: 0,
    binFree: null,
  });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useTrash during scans", () => {
  it("asks the backend while a job runs and allows the items it does not refuse", async () => {
    const roots: Roots = {
      roots: [summary(true)],
      queue: [{ root: "/root", state: "scanning", folder: null }],
    };
    vi.mocked(api.trashRefused).mockResolvedValue(false);
    expect(useRenderTrash(roots).menuTrash).toBeNull();
    expect(api.trashRefused).toHaveBeenCalledWith(1, 4, [7]);
    await flush();
    const trash = useRenderTrash(roots);
    expect(trash.trashNote).toBeNull();
    trash.menuTrash?.();
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [7]);
  });

  it("disables the action for refused marked items and says why", async () => {
    const roots: Roots = {
      roots: [summary(true)],
      queue: [{ root: "/root", state: "scanning", folder: null }],
    };
    vi.mocked(api.trashRefused).mockResolvedValue(true);
    useRenderTrash(roots).onMarks([8, 9]);
    useRenderTrash(roots);
    expect(api.trashRefused).toHaveBeenLastCalledWith(1, 4, [8, 9]);
    await flush();
    const trash = useRenderTrash(roots);
    expect(trash.menuTrash).toBeNull();
    expect(trash.trashNote).toBe("trash.scanningItems");
  });

  it("asks nothing while a rescan only waits in the queue", () => {
    const roots: Roots = {
      roots: [summary(false)],
      queue: [{ root: "/root", state: "queued", folder: null }],
    };
    const trash = useRenderTrash(roots);
    expect(trash.menuTrash).toBeTypeOf("function");
    trash.menuTrash?.();
    expect(api.trashRefused).not.toHaveBeenCalled();
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [7]);
    expect(api.trash).not.toHaveBeenCalled();
  });

  it("allows marked children of the selected root while a rescan waits", () => {
    const roots: Roots = {
      roots: [summary(false)],
      queue: [{ root: "/root", state: "queued", folder: null }],
    };
    const unmarked = useRenderTrash(roots, 0);
    expect(unmarked.menuTrash).toBeNull();
    unmarked.onMarks([8, 9]);

    useRenderTrash(roots, 0).menuTrash?.();
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [8, 9]);
  });

  it("leaves direct requests to the backend and says why it refuses them", async () => {
    const roots: Roots = {
      roots: [summary(false)],
      queue: [{ root: "/root", state: "scanning", folder: null }],
    };
    vi.mocked(api.trashPreview).mockRejectedValue({ code: "Busy" });
    const [onError, push] = [vi.fn(), vi.fn()];
    useRenderTrash(roots, 7, onError, push).onTrash(1, [7]);
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [7]);
    await flush();
    expect(push).toHaveBeenCalledWith("trash.scanningItem");
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the last answer while a live update asks again, and asks again for a new job", async () => {
    const job = { root: "/root", state: "scanning", folder: null } as const;
    const at = (rev: number, folder: string | null = null): Roots => ({
      roots: [{ ...summary(true), rev }],
      queue: [{ ...job, folder }],
    });
    vi.mocked(api.trashRefused).mockResolvedValue(false);
    useRenderTrash(at(4));
    await flush();
    const later = useRenderTrash(at(5));
    expect(later.menuTrash).toBeTypeOf("function");
    expect(later.trashNote).toBeNull();
    expect(api.trashRefused).toHaveBeenLastCalledWith(1, 5, [7]);
    await flush();
    const calls = vi.mocked(api.trashRefused).mock.calls.length;
    useRenderTrash(at(5, "/root/sub"));
    expect(api.trashRefused).toHaveBeenCalledTimes(calls + 1);
  });

  it("asks once for the same items when two views ask at the same time", async () => {
    const job = { root: "/root", state: "scanning", folder: null } as const;
    hooks.beginRender();
    useTrashRefused(job, 1, 4, [7]);
    useTrashRefused(job, 1, 4, [7]);
    expect(api.trashRefused).toHaveBeenCalledTimes(1);
    await flush();
  });
});

describe("useTrash while it moves items", () => {
  it("dims the rows, blocks another request, offers Stop, then reports what moved", async () => {
    const roots: Roots = { roots: [summary(false)], queue: [] };
    let finish: (result: TrashResult) => void = () => {};
    vi.mocked(api.trash).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    vi.mocked(api.cancelTrash).mockResolvedValue(0);
    const push = vi.fn();
    useRenderTrash(roots, 7, vi.fn(), push).onTrash(1, [7]);
    await flush();
    const asking = useRenderTrash(roots, 7, vi.fn(), push);
    (asking.dialog as ReactElement<{ onConfirm: () => void }>).props.onConfirm();
    expect(api.trash).toHaveBeenCalledWith(expect.any(Number), 1, 4, [7], false);

    const running = useRenderTrash(roots, 7, vi.fn(), push);
    expect([running.busy, running.root, running.menuTrash]).toEqual([true, "/root", null]);
    expect(running.moving.map((r) => [r.generation, r.ids, r.purge])).toEqual([[1, [7], false]]);
    expect(running.trashNote).toBe("trash.busy");
    expect(running.window).toBeNull();
    (running.status as ReactElement<{ onStop: () => void }>).props.onStop();
    expect(api.cancelTrash).toHaveBeenCalledWith(vi.mocked(api.trash).mock.calls[0][0]);

    finish({
      removed: 1,
      failed: [],
      warning: null,
      stopped: false,
      gone: 0,
      cancelled: false,
    });
    await flush();
    expect(push).toHaveBeenCalledWith("trash.doneOne");
    const after = useRenderTrash(roots, 7, vi.fn(), push);
    expect([after.busy, after.moving, after.status]).toEqual([false, [], null]);
  });

  it("shows a window with Stop for more than 20 items, and no Stop in the status bar", async () => {
    const roots: Roots = { roots: [summary(false)], queue: [] };
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.trashPreview).mockResolvedValue({
      count: 21,
      size: 1,
      scannedAt: 1,
      paths: [],
      binSize: 0,
      binFree: null,
    });
    useRenderTrash(roots).onTrash(1, [7]);
    await flush();
    (useRenderTrash(roots).dialog as ReactElement<{ onConfirm: () => void }>).props.onConfirm();
    const running = useRenderTrash(roots);
    expect(running.window).not.toBeNull();
    expect((running.status as ReactElement<{ onStop: unknown }>).props.onStop).toBeNull();
  });
});

type Dialog = ReactElement<{ onConfirm: () => void; onClose: () => void; cleanup?: boolean }>;

describe("useTrash in the clean-up lists", () => {
  const roots: Roots = { roots: [summary(false)], queue: [] };
  const done: TrashResult = {
    removed: 1,
    failed: [],
    warning: null,
    stopped: false,
    gone: 0,
    cancelled: false,
  };
  /** One render of the hook, as the app shell does. */
  const Shell = (push: Parameters<typeof useRenderTrash>[3]) =>
    useRenderTrash(roots, 7, vi.fn(), push);
  /** The dialog once the preview of the request that `ask` makes has come. */
  async function asked(ask: (trash: ReturnType<typeof Shell>) => void, push = vi.fn()) {
    ask(Shell(push));
    await flush();
    return Shell(push).dialog as Dialog;
  }

  it("asks with its own dialog before deleting for good, and deletes only on its answer", async () => {
    vi.mocked(api.deleteForGood).mockResolvedValue(done);
    const push = vi.fn();
    const dialog = await asked((trash) => trash.onPurge(1, [7]), push);
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [7]);
    expect(dialog.type).toBe(PurgeDialog);
    expect(api.deleteForGood).not.toHaveBeenCalled();
    expect(api.trash).not.toHaveBeenCalled();

    dialog.props.onConfirm();
    expect(api.deleteForGood).toHaveBeenCalledWith(expect.any(Number), 1, 4, [7]);
    expect(api.trash).not.toHaveBeenCalled();
    await flush();
    expect(push).toHaveBeenCalledWith("purge.done");
  });

  it("deletes nothing when the dialog is closed", async () => {
    const dialog = await asked((trash) => trash.onPurge(1, [7]));
    dialog.props.onClose();
    expect(useRenderTrash(roots).dialog).toBeNull();
    expect(api.deleteForGood).not.toHaveBeenCalled();
  });

  it("moves clean-up rows to the trash with the clean-up checks and says the bin must be emptied", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    const push = vi.fn();
    const dialog = await asked((trash) => trash.onTrash(1, [7], true), push);
    expect(dialog.type).toBe(TrashDialog);
    expect(dialog.props.cleanup).toBe(true);
    dialog.props.onConfirm();
    expect(api.trash).toHaveBeenCalledWith(expect.any(Number), 1, 4, [7], true);
    await flush();
    expect(push).toHaveBeenCalledWith("trash.doneCleanup");
  });

  it("moves other rows to the trash without the clean-up checks", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    const dialog = await asked((trash) => trash.onTrash(1, [7]));
    expect(dialog.props.cleanup).toBe(false);
    dialog.props.onConfirm();
    expect(api.trash).toHaveBeenCalledWith(expect.any(Number), 1, 4, [7], false);
  });

  it("takes marked clean-up rows to the trash as clean-up rows from the menu bar", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    useRenderTrash(roots).onMarks([8, 9], true);
    const dialog = await asked((trash) => trash.menuTrash?.());
    expect(dialog.props.cleanup).toBe(true);
    dialog.props.onConfirm();
    expect(api.trash).toHaveBeenCalledWith(expect.any(Number), 1, 4, [8, 9], true);
  });

  it("takes the selected item as a clean-up row when the list says it is one and nothing is marked", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    Shell(vi.fn()).onMarks([], true, 7);
    const dialog = await asked((trash) => trash.menuTrash?.());
    expect(dialog.props.cleanup).toBe(true);
    dialog.props.onConfirm();
    expect(api.trash).toHaveBeenCalledWith(expect.any(Number), 1, 4, [7], true);
  });

  it("takes the selected item as before when it is no row of the clean-up list", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    // Another row of the list is the selected one, or none is (the list's own folder).
    for (const row of [8, null]) {
      Shell(vi.fn()).onMarks([], true, row);
      const dialog = await asked((trash) => trash.menuTrash?.());
      expect(dialog.props.cleanup).toBe(false);
      dialog.props.onClose();
    }
  });

  it("gives every request its own purge dialog: a new one starts at the first question", async () => {
    const first = await asked((trash) => trash.onPurge(1, [7]));
    first.props.onClose();
    const second = await asked((trash) => trash.onPurge(1, [7]));
    expect(second.key).not.toBeNull();
    expect(second.key).not.toBe(first.key);
  });

  it("asks for no other request while one runs: the backend's Stop is shared", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    (await asked((trash) => trash.onTrash(1, [7], true))).props.onConfirm();
    vi.mocked(api.trashPreview).mockClear();
    const running = useRenderTrash(roots);
    running.onPurge(1, [7]);
    running.onTrash(1, [7]);
    expect(api.trashPreview).not.toHaveBeenCalled();
    expect(running.menuTrash).toBeNull();
  });

  const preview = { count: 1, size: 1, scannedAt: 1, paths: ["/a"], binSize: 0, binFree: null };
  /** Previews that come when the test resolves them. */
  function heldPreviews() {
    const previews: ((p: TrashPreview) => void)[] = [];
    vi.mocked(api.trashPreview).mockImplementation(
      () => new Promise((resolve) => previews.push(resolve)),
    );
    return previews;
  }

  it("keeps the first question of two asked at once", async () => {
    const previews = heldPreviews();
    const first = useRenderTrash(roots);
    first.onTrash(1, [7]);
    first.onPurge(1, [8]);
    previews[0](preview);
    previews[1](preview);
    await flush();
    expect((useRenderTrash(roots).dialog as Dialog).type).toBe(TrashDialog);
  });

  it("starts nothing from a question that comes while another request runs", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    const previews = heldPreviews();
    const push = vi.fn();
    const first = useRenderTrash(roots, 7, vi.fn(), push);
    first.onTrash(1, [7]);
    first.onPurge(1, [8]);
    previews[0](preview);
    await flush();
    // The trash question is shown and answered: its request runs.
    (useRenderTrash(roots, 7, vi.fn(), push).dialog as Dialog).props.onConfirm();
    expect(api.trash).toHaveBeenCalledOnce();
    // The late question comes while it runs: answering it starts nothing.
    previews[1](preview);
    await flush();
    const late = useRenderTrash(roots, 7, vi.fn(), push).dialog as Dialog;
    expect(late.type).toBe(PurgeDialog);
    late.props.onConfirm();
    expect(api.deleteForGood).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("trash.busy");
  });
});

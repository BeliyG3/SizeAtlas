import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary } from "../api/types";
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
  api: { trashPreview: vi.fn(), trash: vi.fn(), trashRefused: vi.fn() },
  isCmdError: (e: unknown) => typeof e === "object" && e !== null && "code" in e,
}));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../features/trash/TrashDialog", () => ({ TrashDialog: () => null }));

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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary } from "../api/types";
import { rootEntries } from "./roots";
import { useTrash } from "./useTrash";

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
}));
vi.mock("../api/client", () => ({
  api: { trashPreview: vi.fn(), trash: vi.fn() },
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

function useRenderTrash(roots: Roots, id = 7, onError = vi.fn()) {
  hooks.beginRender();
  return useTrash({
    roots,
    entries: rootEntries(roots),
    selection: { root: "/root", generation: 1, id, folder: id },
    push: vi.fn(),
    onError,
    errorText: String,
  });
}

beforeEach(() => {
  hooks.state.values = [];
  hooks.state.refs = [];
  vi.clearAllMocks();
  vi.mocked(api.trashPreview).mockResolvedValue({
    count: 1,
    size: 10,
    scannedAt: 1,
    paths: ["/root/file"],
  });
});

describe("useTrash live scan actions", () => {
  it("disables the actual menu action for selected and marked items during a first scan", () => {
    const roots: Roots = {
      roots: [summary(true)],
      queue: [{ root: "/root", state: "scanning", folder: null }],
    };
    const selected = useRenderTrash(roots);
    expect(selected.menuTrash).toBeNull();
    selected.onMarks([8, 9]);

    expect(useRenderTrash(roots).menuTrash).toBeNull();
    expect(api.trashPreview).not.toHaveBeenCalled();
  });

  it("allows the actual menu action while a rescan waits in the queue", () => {
    const roots: Roots = {
      roots: [summary(false)],
      queue: [{ root: "/root", state: "queued", folder: null }],
    };
    const trash = useRenderTrash(roots);
    expect(trash.busyRoots.has("/root")).toBe(false);
    expect(trash.menuTrash).toBeTypeOf("function");
    trash.menuTrash?.();

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

  it("keeps trash blocked during a running rescan and guards direct requests", () => {
    const roots: Roots = {
      roots: [summary(false)],
      queue: [{ root: "/root", state: "scanning", folder: null }],
    };
    const onError = vi.fn();
    const trash = useRenderTrash(roots, 7, onError);
    expect(trash.menuTrash).toBeNull();
    trash.onTrash(1, [7]);

    expect(onError).toHaveBeenCalledWith({ code: "Busy" });
    expect(api.trashPreview).not.toHaveBeenCalled();
  });
});

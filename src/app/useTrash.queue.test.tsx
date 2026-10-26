import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary, TrashProgress, TrashResult } from "../api/types";
import { rootEntries } from "./roots";
import { useTrash } from "./useTrash";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateAt: 0,
  refAt: 0,
  progress: null as ((p: TrashProgress) => void) | null,
  begin() {
    this.stateAt = 0;
    this.refAt = 0;
  },
}));

// Keep state across explicit renders without mounting a DOM or a renderer.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const at = hooks.stateAt++;
    if (!(at in hooks.values)) hooks.values[at] = initial;
    return [
      hooks.values[at],
      (next: unknown) => {
        hooks.values[at] = typeof next === "function" ? next(hooks.values[at]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => (hooks.refs[hooks.refAt++] ??= { current: initial }),
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
  isCmdError: () => false,
  onTrashProgress: (cb: (p: TrashProgress) => void) => {
    hooks.progress = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock("../settings/react", () => ({ useSize: () => String }));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../features/trash/TrashDialog", () => ({ TrashDialog: () => null }));
vi.mock("../features/trash/PurgeDialog", () => ({ PurgeDialog: () => null }));

const summary: Summary = {
  root: "/root",
  rootId: 0,
  generation: 1,
  rev: 4,
  scanning: false,
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
};
const roots: Roots = { roots: [summary], queue: [] };
const done: TrashResult = {
  removed: 1,
  failed: [],
  warning: null,
  stopped: false,
  gone: 0,
  cancelled: false,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** One render of the hook, as the app shell does. */
function Shell(push = vi.fn()) {
  hooks.begin();
  return useTrash({
    roots,
    entries: rootEntries(roots),
    selection: { root: "/root", generation: 1, id: 7, folder: 7 },
    push,
    onTrashed: () => {},
    onError: vi.fn(),
    errorText: String,
  });
}

/** Asks for the trash of item 7 and confirms it. */
async function confirmed(push = vi.fn()) {
  Shell(push).onTrash(1, [7]);
  await flush();
  (Shell(push).dialog as ReactElement<{ onConfirm: () => void }>).props.onConfirm();
}

type Status = ReactElement<{ progress: TrashProgress; onStop: () => void }>;

beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(5000);
  vi.mocked(api.trashRefused).mockResolvedValue(false);
  vi.mocked(api.cancelTrash).mockResolvedValue(0);
  vi.mocked(api.trashPreview).mockResolvedValue({
    count: 3,
    size: 10,
    scannedAt: 1,
    paths: ["/root/file"],
    binSize: 0,
    binFree: null,
  });
});

describe("useTrash with numbered requests", () => {
  it("numbers the requests from the clock, one more each time", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    await confirmed();
    expect(api.trash).toHaveBeenLastCalledWith(5000, 1, 4, [7], false);
    await flush();
    await confirmed();
    expect(api.trash).toHaveBeenLastCalledWith(5001, 1, 4, [7], false);
  });

  it("stops its own request", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed();
    (Shell().status as Status).props.onStop();
    expect(api.cancelTrash).toHaveBeenCalledWith(5000);
  });

  it("shows only the progress of its own request", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed();
    Shell();
    hooks.progress?.({ request: 4999, done: 2, total: 9, current: "/other" });
    expect((Shell().status as Status).props.progress).toEqual({
      request: 5000,
      done: 0,
      total: 3,
      current: null,
    });
    const own = { request: 5000, done: 1, total: 3, current: "/root/file" };
    hooks.progress?.(own);
    expect((Shell().status as Status).props.progress).toEqual(own);
  });

  it("keeps the progress of its request when an event of another one comes after", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed();
    Shell();
    const own = { request: 5000, done: 2, total: 3, current: "/root/file" };
    hooks.progress?.(own);
    hooks.progress?.({ request: 4999, done: 0, total: 9, current: "/other" });
    expect((Shell().status as Status).props.progress).toEqual(own);
  });

  it("reports nothing for a request cancelled while it waited", async () => {
    const cancelled = { ...done, removed: 0, stopped: true, cancelled: true };
    vi.mocked(api.trash).mockResolvedValue(cancelled);
    const push = vi.fn();
    await confirmed(push);
    await flush();
    expect(push).not.toHaveBeenCalled();
    expect(Shell(push).busy).toBe(false);
  });
});

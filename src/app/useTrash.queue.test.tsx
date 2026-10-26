import { Children, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary, TrashPreview, TrashProgress, TrashResult } from "../api/types";
import { TrashStatus } from "../features/trash/TrashProgress";
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
    getSummary: vi.fn(),
  },
  isCmdError: (e: unknown) => typeof e === "object" && e !== null && "code" in e,
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
  size: 0,
  cancelled: false,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const shown: TrashPreview = {
  count: 3,
  size: 10,
  scannedAt: 1,
  paths: ["/root/file"],
  binSize: 0,
  binFree: null,
};
const stale = { code: "StaleId" };

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

/** Asks for the trash of item `id` and confirms it. */
async function confirmed(push = vi.fn(), id = 7) {
  Shell(push).onTrash(1, [id]);
  await flush();
  (Shell(push).dialog as ReactElement<{ onConfirm: () => void }>).props.onConfirm();
}

type Line = ReactElement<{ progress?: TrashProgress; onStop: () => void; children?: string }>;
/** The lines of the status bar: one per started request, then "+N". */
const lines = (push = vi.fn()) =>
  Children.toArray(
    (Shell(push).status as ReactElement<{ children: ReactNode }> | null)?.props.children,
  ) as Line[];
/** The windows of the started requests of many items. */
const windowsOf = () =>
  Children.toArray(
    (Shell().windows as ReactElement<{ children: ReactNode }> | null)?.props.children,
  ) as Line[];
const label = (line: Line) => line.props.progress?.request ?? line.props.children;
/** The request `request` starts: the backend reports its first progress. */
const started = (request: number, done = 0) =>
  hooks.progress?.({ request, done, total: 3, current: done ? "/root/file" : null });

beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(5000);
  vi.mocked(api.trashRefused).mockResolvedValue(false);
  vi.mocked(api.cancelTrash).mockResolvedValue(0);
  vi.mocked(api.getSummary).mockResolvedValue({ ...summary, rev: 5 });
  vi.mocked(api.trashPreview).mockResolvedValue(shown);
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
    started(5000);
    lines()[0].props.onStop();
    expect(api.cancelTrash).toHaveBeenCalledWith(5000);
  });

  it("shows only the progress of its own request", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed();
    Shell();
    hooks.progress?.({ request: 4999, done: 2, total: 9, current: "/other" });
    expect(lines()).toEqual([]);
    started(5000, 1);
    expect(lines()[0].props.progress).toEqual({
      request: 5000,
      done: 1,
      total: 3,
      current: "/root/file",
    });
  });

  it("keeps the progress of its request when an event of another one comes after", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed();
    Shell();
    const own = { request: 5000, done: 2, total: 3, current: "/root/file" };
    hooks.progress?.(own);
    hooks.progress?.({ request: 4999, done: 0, total: 9, current: "/other" });
    expect(lines()[0].props.progress).toEqual(own);
  });

  it("reports nothing for a request cancelled while it waited", async () => {
    const cancelled = { ...done, removed: 0, stopped: true, cancelled: true };
    vi.mocked(api.trash).mockResolvedValue(cancelled);
    const push = vi.fn();
    await confirmed(push);
    await flush();
    expect(push).not.toHaveBeenCalled();
    expect(Shell(push).moving).toEqual([]);
  });

  it("keeps the trash menu open while another request runs", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed(vi.fn(), 8);
    const trash = Shell();
    expect(trash.menuTrash).not.toBeNull();
    expect(trash.trashNote).toBeNull();
  });

  it("starts the next request at once, with the next number", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed(vi.fn(), 8);
    await confirmed(vi.fn(), 9);
    expect(vi.mocked(api.trash).mock.calls.map((call) => call[0])).toEqual([5000, 5001]);
  });

  it("refuses the items a request already has: no menu, a note, no question", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    const push = vi.fn();
    await confirmed(push);
    const trash = Shell(push);
    expect(trash.menuTrash).toBeNull();
    expect(trash.trashNote).toBe("trash.already");
    vi.mocked(api.trashPreview).mockClear();
    trash.onTrash(1, [7]);
    trash.onPurge(1, [6, 7]);
    expect(api.trashPreview).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith("trash.already");
  });

  it("starts nothing from a late question whose items a request took meanwhile", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    const previews: (() => void)[] = [];
    const preview = { count: 1, size: 1, scannedAt: 1, paths: [], binSize: 0, binFree: null };
    vi.mocked(api.trashPreview).mockImplementation(
      () => new Promise((resolve) => previews.push(() => resolve(preview))),
    );
    const push = vi.fn();
    const first = Shell(push);
    first.onTrash(1, [7]);
    first.onPurge(1, [7]);
    previews[0]();
    await flush();
    (Shell(push).dialog as ReactElement<{ onConfirm: () => void }>).props.onConfirm();
    previews[1]();
    await flush();
    (Shell(push).dialog as ReactElement<{ onConfirm: () => void }>).props.onConfirm();
    expect(api.trash).toHaveBeenCalledOnce();
    expect(api.deleteForGood).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("trash.already");
  });

  it("moves the progress of the request it belongs to only", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    await confirmed(vi.fn(), 8);
    await confirmed(vi.fn(), 9);
    const second = { request: 5001, done: 2, total: 3, current: "/root/file" };
    hooks.progress?.(second);
    expect(Shell().moving.map((r) => r.progress)).toEqual([null, second]);
  });

  it("says how many waiting requests Stop cancelled", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.cancelTrash).mockResolvedValue(1);
    const push = vi.fn();
    await confirmed(push);
    started(5000, 1);
    lines(push)[0].props.onStop();
    await flush();
    expect(api.cancelTrash).toHaveBeenCalledWith(5000);
    expect(push).toHaveBeenCalledWith("trash.cancelledQueued");
  });

  /** Confirms the requests of items 8, 9 and 10 and starts all of them. */
  async function threeStarted(finish: ((result: TrashResult) => void)[]) {
    vi.mocked(api.trash).mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    for (const id of [8, 9, 10]) await confirmed(vi.fn(), id);
    for (const request of [5000, 5001, 5002]) started(request);
  }

  it("shows two status lines and how many more there are", async () => {
    await threeStarted([]);
    expect(lines().map((line) => line.type)).toEqual([TrashStatus, TrashStatus, "bdi"]);
    expect(lines().map(label)).toEqual([5000, 5001, "+1"]);
    expect((lines()[2].props as { dir?: string }).dir).toBe("ltr");
  });

  it("gives each started request of many items a window with its own Stop", async () => {
    vi.mocked(api.trash).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.trashPreview).mockResolvedValue({
      count: 21,
      size: 1,
      scannedAt: 1,
      paths: [],
      binSize: 0,
      binFree: null,
    });
    await confirmed(vi.fn(), 8);
    await confirmed(vi.fn(), 9);
    started(5000);
    expect(windowsOf()).toHaveLength(1);
    started(5001);
    const windows = windowsOf();
    expect(windows).toHaveLength(2);
    windows[1].props.onStop();
    expect(api.cancelTrash).toHaveBeenCalledWith(5001);
  });

  it("keeps the first request in the status bar when the second ends first", async () => {
    const finish: ((result: TrashResult) => void)[] = [];
    await threeStarted(finish);
    finish[1](done);
    await flush();
    expect(lines().map(label)).toEqual([5000, 5002]);
  });
});

// Another request of the root ended while the dialog was open: its revision is out of date.
describe("useTrash when the tree changed under a question", () => {
  const dialog = () =>
    Shell().dialog as ReactElement<{ preview: TrashPreview; onConfirm: () => void }>;

  it("sends the same items again at the new revision when they are as shown", async () => {
    vi.mocked(api.trash).mockRejectedValueOnce(stale).mockResolvedValueOnce(done);
    const push = vi.fn();
    await confirmed(push);
    await flush();
    expect(vi.mocked(api.trash).mock.calls).toEqual([
      [5000, 1, 4, [7], false],
      [5001, 1, 5, [7], false],
    ]);
    expect(api.trashPreview).toHaveBeenLastCalledWith(1, 5, [7]);
    expect(Shell(push).dialog).toBeNull();
    expect(push).not.toHaveBeenCalledWith("trash.notRemoved");
    expect(Shell().moving).toEqual([]);
  });

  it("asks again when the items are no longer as shown, and sends only after that", async () => {
    vi.mocked(api.trash).mockRejectedValueOnce(stale).mockResolvedValueOnce(done);
    vi.mocked(api.trashPreview)
      .mockResolvedValueOnce(shown)
      .mockResolvedValueOnce({ ...shown, size: 7 });
    await confirmed();
    await flush();
    expect(api.trash).toHaveBeenCalledOnce();
    expect(dialog().props.preview.size).toBe(7);
    dialog().props.onConfirm();
    expect(api.trash).toHaveBeenLastCalledWith(5001, 1, 5, [7], false);
  });

  it("asks again before deleting for good when the paths differ, even at the same size", async () => {
    vi.mocked(api.deleteForGood).mockRejectedValueOnce(stale).mockResolvedValueOnce(done);
    vi.mocked(api.trashPreview)
      .mockResolvedValueOnce(shown)
      .mockResolvedValueOnce({ ...shown, paths: ["/root/other"] });
    Shell().onPurge(1, [7]);
    await flush();
    dialog().props.onConfirm();
    await flush();
    expect(api.deleteForGood).toHaveBeenCalledOnce();
    expect(dialog().props.preview.paths).toEqual(["/root/other"]);
  });

  it("says nothing was removed when the items are gone", async () => {
    vi.mocked(api.trash).mockRejectedValue(stale);
    vi.mocked(api.trashPreview).mockResolvedValueOnce(shown).mockRejectedValueOnce(stale);
    const push = vi.fn();
    await confirmed(push);
    await flush();
    expect(api.trash).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("trash.notRemoved");
    expect(Shell(push).dialog).toBeNull();
    expect(Shell().moving).toEqual([]);
  });

  it("asks at the new revision when the preview was out of date", async () => {
    vi.mocked(api.trash).mockResolvedValue(done);
    vi.mocked(api.trashPreview).mockRejectedValueOnce(stale).mockResolvedValueOnce(shown);
    Shell().onTrash(1, [7]);
    await flush();
    expect(api.trashPreview).toHaveBeenLastCalledWith(1, 5, [7]);
    dialog().props.onConfirm();
    expect(api.trash).toHaveBeenCalledExactlyOnceWith(5000, 1, 5, [7], false);
  });
});

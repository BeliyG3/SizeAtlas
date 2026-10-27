import type { ComponentProps, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary } from "../api/types";
import { AppMenuBar } from "../features/menubar/AppMenuBar";
import { Toolbar } from "../features/shell/Toolbar";
import { App } from "./App";
import { Browser } from "./Browser";
import { useChangeKeys } from "./useChangeKeys";
import { useRoots } from "./useRoots";
import { useSelection } from "./useSelection";
import { writeStored } from "../settings/storage";

// App's real action composition runs; child rendering and unrelated app hooks do not.
// Every state of App shares one setter, so that a test sees what App sets.
const setState = vi.hoisted(() => vi.fn());
const setMode = vi.hoisted(() => vi.fn());
// The stored mode, and what else storage holds.
const stored = vi.hoisted(() => ({ mode: "all", values: {} as Record<string, string> }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, setState],
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
  useEffect: (commit: () => void) => commit(),
  useLayoutEffect: (commit: () => void) => commit(),
}));
vi.mock("../api/client", () => ({
  api: { refreshFolder: vi.fn(), trashPreview: vi.fn(), trash: vi.fn(), trashRefused: vi.fn() },
  isCmdError: () => false,
  onTrashProgress: () => Promise.resolve(() => {}),
}));
vi.mock("../settings/react", () => ({ useSize: () => String }));
vi.mock("./useRoots", () => ({ useRoots: vi.fn() }));
vi.mock("./useSelection", () => ({ useSelection: vi.fn() }));
vi.mock("./useChangeKeys", () => ({ useChangeKeys: vi.fn() }));
vi.mock("../features/search/useSearchKey", () => ({ useSearchKey: vi.fn() }));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../settings/storage", () => ({
  useStored: () => [stored.mode, setMode],
  readStored: (key: string) => stored.values[key] ?? null,
  writeStored: vi.fn(),
}));
vi.mock("../features/export/useExport", () => ({
  useExport: () => ({ run: vi.fn(), register: vi.fn(), separator: "," }),
}));
vi.mock("../features/toasts/Toasts", () => ({
  Toasts: () => null,
  useToasts: () => ({
    toasts: [],
    push: vi.fn(),
    pushError: vi.fn(),
    errorText: String,
  }),
}));
vi.mock("../features/menubar/AppMenuBar", () => ({ AppMenuBar: () => null }));
vi.mock("../features/shell/useAccess", () => ({ useAccess: () => ({ banner: null, chip: null }) }));
vi.mock("../features/update/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("../features/update/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    offered: null,
    dismiss: vi.fn(),
    checkNow: vi.fn(),
    auto: true,
    setAuto: vi.fn(),
  }),
}));
vi.mock("../features/shell/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../features/shell/Toolbar", () => ({ Toolbar: () => null }));
vi.mock("../features/shell/chooseFolder", () => ({ chooseFolder: vi.fn() }));
vi.mock("../features/trash/TrashDialog", () => ({ TrashDialog: () => null }));
vi.mock("./Browser", () => ({ Browser: () => null }));

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

/** The first element of `type` in the tree that `node` is the root of. */
function findElement<P>(node: unknown, type: (props: P) => ReactNode): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: unknown; value?: unknown }>;
  if (element.type === type) return element as never;
  return findElement(element.props.children, type);
}

function render(scanning: boolean, state: "queued" | "scanning", folder: number) {
  const roots: Roots = {
    roots: [summary(scanning)],
    queue: [{ root: "/root", state, folder: null }],
  };
  const running = state === "scanning" ? roots.queue[0] : null;
  vi.mocked(useRoots).mockReturnValue({
    roots,
    sources: { disks: [], scans: [] },
    scanning: running?.root ?? null,
    running,
    progress: null,
    closing: false,
    restoring: false,
    scan: vi.fn(),
    cancel: vi.fn(),
    openCached: vi.fn(),
    closeRoot: vi.fn(),
    forget: vi.fn(),
    refreshRoots: vi.fn(),
    refreshRootsNow: vi.fn(),
  });
  vi.mocked(useSelection).mockReturnValue({
    selection: { root: "/root", generation: 1, id: folder, folder },
    selectRoot: vi.fn(),
    selectNode: vi.fn(),
    history: {
      canBack: false,
      canForward: false,
      back: vi.fn(),
      forward: vi.fn(),
      record: vi.fn(),
    },
  });
  const menu = App().props.children[0] as ReactElement<ComponentProps<typeof AppMenuBar>>;
  expect(menu.type).toBe(AppMenuBar);
  const keys = vi.mocked(useChangeKeys).mock.calls.at(-1)?.[0];
  expect(keys).toBeDefined();
  return { menu: menu.props, keys: keys! };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored.mode = "all";
  stored.values = {};
  vi.mocked(api.refreshFolder).mockResolvedValue();
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

describe("App live scan action wiring", () => {
  it.each([0, 7])("disables menu refresh and F5 for folder %i during a first scan", (folder) => {
    const { menu, keys } = render(true, "scanning", folder);
    expect(menu.onRefresh).toBeNull();
    expect(menu.onTrash).toBeNull();
    keys.onRefresh();
    keys.onDelete();

    expect(api.refreshFolder).not.toHaveBeenCalled();
    expect(api.trashPreview).not.toHaveBeenCalled();
    // Until the backend says the item may go; the root itself never goes.
    if (folder === 0) expect(api.trashRefused).not.toHaveBeenCalled();
    else expect(api.trashRefused).toHaveBeenCalledWith(1, 4, [7]);
  });

  it.each([0, 7])("disables menu refresh and F5 for folder %i during a rescan", (folder) => {
    const { menu, keys } = render(false, "scanning", folder);
    expect(menu.onRefresh).toBeNull();
    keys.onRefresh();
    expect(api.refreshFolder).not.toHaveBeenCalled();
  });

  it.each([0, 7])("allows menu refresh and F5 for folder %i while a rescan waits", (folder) => {
    const { menu, keys } = render(false, "queued", folder);
    expect(menu.onRefresh).toBeTypeOf("function");
    expect(menu.refreshIsRescan).toBe(folder === 0);
    // A pending full rescan disables Ctrl+F5, but it must not disable plain F5.
    expect(menu.rescanTarget).toBeNull();
    menu.onRefresh?.();
    keys.onRefresh();

    expect(api.refreshFolder).toHaveBeenCalledTimes(2);
    expect(api.refreshFolder).toHaveBeenNthCalledWith(1, 1, folder);
    expect(api.refreshFolder).toHaveBeenNthCalledWith(2, 1, folder);
  });

  it("never takes the hidden selection to the trash in the duplicates mode", () => {
    stored.mode = "duplicates";
    const { menu, keys } = render(false, "queued", 7);
    expect(menu.onTrash).toBeNull();
    keys.onDelete();
    expect(api.trashPreview).not.toHaveBeenCalled();
  });

  it("wires menu and Delete to the actual trash action while a rescan waits", () => {
    const { menu, keys } = render(false, "queued", 7);
    expect(menu.onTrash).toBeTypeOf("function");
    menu.onTrash?.();
    keys.onDelete();

    expect(api.trashPreview).toHaveBeenCalledTimes(2);
    expect(api.trashPreview).toHaveBeenCalledWith(1, 4, [7]);
    expect(api.trash).not.toHaveBeenCalled();
  });
});

describe("App search wiring", () => {
  it("clears the query when a mode is picked, and picks the mode", () => {
    render(false, "queued", 0);
    const toolbar = App().props.children[1] as ReactElement<ComponentProps<typeof Toolbar>>;
    expect(toolbar.type).toBe(Toolbar);
    setState.mockClear();
    toolbar.props.onMode("largest");
    expect(setMode).toHaveBeenCalledWith("largest");
    expect(setState).toHaveBeenCalledWith("");
  });

  it("hands the table the committed query and a way to end the search", () => {
    render(false, "queued", 0);
    const browser = findElement(App(), Browser);
    expect(browser?.props.query).toBe("");
    setState.mockClear();
    browser?.props.onLeaveSearch();
    expect(setState).toHaveBeenCalledWith("");
  });

  it("fills the field with the stored search of the duplicates when they are picked", () => {
    render(false, "queued", 0);
    const toolbar = () => App().props.children[1] as ReactElement<ComponentProps<typeof Toolbar>>;
    setState.mockClear();
    toolbar().props.onMode("duplicates");
    expect(setMode).toHaveBeenCalledWith("duplicates");
    expect(setState).toHaveBeenCalledWith("type:image");
    stored.values["sizeatlas.duplicates.query"] = "";
    setState.mockClear();
    toolbar().props.onMode("duplicates");
    expect(setState).toHaveBeenCalledWith("");
  });

  it("starts in the stored duplicates mode with the stored search shown and committed", () => {
    stored.mode = "duplicates";
    render(false, "queued", 0);
    const browser = findElement(App(), Browser);
    expect(browser?.props.field).toBe("type:image");
    expect(browser?.props.query).toBe("type:image");
  });

  it("keeps the search of the duplicates while they are shown, and only then", () => {
    render(false, "queued", 0);
    const toolbar = () => App().props.children[1] as ReactElement<ComponentProps<typeof Toolbar>>;
    toolbar().props.onQuery("backup");
    expect(writeStored).not.toHaveBeenCalled();
    stored.mode = "duplicates";
    stored.values["sizeatlas.duplicates.query"] = "*.png";
    expect(toolbar().props.query).toBe("*.png");
    toolbar().props.onQuery("*.jpg");
    expect(writeStored).toHaveBeenCalledWith("sizeatlas.duplicates.query", "*.jpg");
  });
});

import type { ComponentProps, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Roots, Summary } from "../api/types";
import { AppMenuBar } from "../features/menubar/AppMenuBar";
import { App } from "./App";
import { useChangeKeys } from "./useChangeKeys";
import { useRoots } from "./useRoots";
import { useSelection } from "./useSelection";

// App's real action composition runs; child rendering and unrelated app hooks do not.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
  useEffect: (commit: () => void) => commit(),
  useLayoutEffect: (commit: () => void) => commit(),
}));
vi.mock("../api/client", () => ({
  api: { refreshFolder: vi.fn(), trashPreview: vi.fn(), trash: vi.fn(), trashRefused: vi.fn() },
  isCmdError: () => false,
}));
vi.mock("./useRoots", () => ({ useRoots: vi.fn() }));
vi.mock("./useSelection", () => ({ useSelection: vi.fn() }));
vi.mock("./useChangeKeys", () => ({ useChangeKeys: vi.fn() }));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../settings/storage", () => ({ useStored: () => ["all", vi.fn()] }));
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
vi.mock("../features/shell/AccessBanner", () => ({ AccessBanner: () => null }));
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
});

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
  vi.mocked(api.refreshFolder).mockResolvedValue();
  vi.mocked(api.trashRefused).mockResolvedValue(true);
  vi.mocked(api.trashPreview).mockResolvedValue({
    count: 1,
    size: 10,
    scannedAt: 1,
    paths: ["/root/file"],
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

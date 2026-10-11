import type { ComponentProps, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Roots, Summary } from "../api/types";
import { ItemMenu } from "../features/menu/ItemMenu";
import { Browser } from "./Browser";
import { busyRoots, rootEntries, runningFullScanRoots } from "./roots";

const state = vi.hoisted(() => ({ stateAt: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [
    state.stateAt++ === 0
      ? { kind: "item", generation: 2, target: { id: 7, isDir: true, lossy: false, x: 0, y: 0 } }
      : initial,
    vi.fn(),
  ],
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("../features/menu/ItemMenu", () => ({ ItemMenu: () => null }));
vi.mock("../features/menu/RootMenu", () => ({ RootMenu: () => null }));
vi.mock("../features/shell/Workspace", () => ({ Workspace: () => null }));
vi.mock("../features/drives/DrivesPanel", () => ({ DrivesPanel: () => null }));
vi.mock("../features/tree/FolderTree", () => ({ FolderTree: () => null }));
vi.mock("../features/viewer/Viewer", () => ({ Viewer: () => null }));
vi.mock("../features/scan/ScanView", () => ({ ScanView: () => null }));

function menu(roots: Roots) {
  state.stateAt = 0;
  const children = Browser({
    entries: rootEntries(roots),
    // The menu belongs to another root, so using only the selected root would be wrong.
    selection: { root: "/other", generation: 1, folder: 0, id: 0 },
    mode: "all",
    sources: null,
    progress: null,
    busyRoots: busyRoots(roots),
    fullScans: runningFullScanRoots(roots),
    trashing: false,
    onSelectNode: vi.fn(),
    onSelectRoot: vi.fn(),
    onRescan: vi.fn(),
    onRefresh: vi.fn(),
    onScanFolder: vi.fn(),
    onTrash: vi.fn(),
    onMarks: vi.fn(),
    onCloseRoot: vi.fn(),
    onForget: vi.fn(),
    onCancelScan: vi.fn(),
    onOpenDrive: vi.fn(),
    onScanDrive: vi.fn(),
    onFail: vi.fn(),
  }).props.children as ReactElement[];
  const item = children.find((child) => child?.type === ItemMenu) as ReactElement<
    ComponentProps<typeof ItemMenu>
  >;
  expect(item).toBeDefined();
  return item.props;
}

beforeEach(() => vi.clearAllMocks());

describe("Browser item scan actions", () => {
  it.each([true, false])(
    "disables refresh and Scan this folder during a full scan (first: %s)",
    (scanning) => {
      const actions = menu({
        roots: [
          { root: "/other", generation: 1 } as Summary,
          { root: "/scan", generation: 2, scanning } as Summary,
        ],
        queue: [{ root: "/scan", state: "scanning", folder: null }],
      });
      expect(actions.canRefresh).toBe(false);
      expect(actions.canScan).toBe(false);
    },
  );

  it.each(["queued", "folder"])(
    "keeps refresh and Scan this folder enabled for a %s job",
    (job) => {
      const actions = menu({
        roots: [
          { root: "/other", generation: 1 } as Summary,
          { root: "/scan", generation: 2, scanning: false } as Summary,
        ],
        queue: [
          {
            root: "/scan",
            state: job === "queued" ? "queued" : "scanning",
            folder: job === "folder" ? "/scan/sub" : null,
          },
        ],
      });
      expect(actions.canRefresh).toBe(true);
      expect(actions.canScan).toBe(true);
      expect(actions.canTrash).toBe(job === "queued");
    },
  );

  it("also disables actions for an open root inside the running full scan", () => {
    const actions = menu({
      roots: [
        { root: "/other", generation: 1 } as Summary,
        { root: "/scan/sub", generation: 2, scanning: false } as Summary,
      ],
      queue: [{ root: "/scan", state: "scanning", folder: null }],
    });
    expect(actions.canRefresh).toBe(false);
    expect(actions.canScan).toBe(false);
  });
});

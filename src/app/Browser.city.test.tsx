import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Summary } from "../api/types";
import { CityPane } from "../features/city/CityPane";
import { rt } from "../features/lists/hookRuntime";
import { Workspace } from "../features/shell/Workspace";
import { Browser } from "./Browser";
import type { RootEntry } from "./roots";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../features/lists/hookRuntime")).rt.hooks,
}));
vi.mock("../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

const tree = (root: string, generation: number) => ({ root, generation, rev: 5 }) as Summary;
const entries: RootEntry[] = [
  { root: "/a", summary: tree("/a", 1), status: "open" },
  { root: "/b", summary: tree("/b", 2), status: "open" },
  { root: "/c", summary: null, status: "scanning" },
];
const none = () => {};
const onSelectNode = vi.fn();
const onFail = vi.fn();

/** The props Browser gives the city for `selection`. */
function cityFor(selection: Parameters<typeof Browser>[0]["selection"]) {
  rt.state.slots = [];
  rt.state.at = 0;
  const shown = Browser({
    entries,
    selection,
    mode: "all",
    query: "",
    duplicates: {} as never,
    onLeaveSearch: none,
    sources: null,
    progress: null,
    onSelectNode,
    onSelectRoot: none,
    onRescan: none,
    onRefresh: none,
    onScanFolder: none,
    onTrash: none,
    onPurge: none,
    onMarks: none,
    busyRoots: new Set(),
    job: null,
    fullScans: new Set(),
    isRemoving: () => false,
    trashingRoots: new Set(),
    onCloseRoot: none,
    onForget: none,
    onCancelScan: none,
    onOpenDrive: none,
    onScanDrive: none,
    onFail,
  }) as ReactElement<{ children: ReactElement[] }>;
  const workspace = [shown.props.children].flat().find((el) => el?.type === Workspace)!;
  const city = (workspace.props as { city: ReactElement }).city;
  expect(city.type).toBe(CityPane);
  return city.props as Parameters<typeof CityPane>[0];
}

beforeEach(() => vi.clearAllMocks());

describe("Browser and the 3D city", () => {
  it("gives the city every open tree and the selected node", () => {
    const selection = { root: "/b", generation: 2, id: 7, folder: 7 };
    const city = cityFor(selection);
    // The root still waiting for its first scan is no island.
    expect(city.roots).toEqual([
      { generation: 1, rev: 5 },
      { generation: 2, rev: 5 },
    ]);
    expect(city.selection).toBe(selection);
    expect(city.onFail).toBe(onFail);
  });

  it("selects a folder picked in the city as a folder of that tree", () => {
    cityFor({ root: "/b", generation: 2, id: 7, folder: 7 }).onSelect(1, 9);
    expect(onSelectNode).toHaveBeenCalledWith(1, 9, true);
  });

  it.each([
    ["no root is selected", null],
    ["the selected root has no tree yet", { root: "/c", generation: null, id: 0, folder: 0 }],
  ])("gives it no tree when %s", (_, selection) => {
    expect(cityFor(selection).selection).toBeNull();
  });
});

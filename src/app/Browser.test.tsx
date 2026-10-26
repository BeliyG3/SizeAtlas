import { describe, expect, it } from "vitest";
import type { Roots, Summary } from "../api/types";
import { itemMenuActions } from "./itemActions";
import { rootEntries, runningFullScanRoots } from "./roots";

function menu(roots: Roots, generation = 2, trashingRoots: ReadonlySet<string> = new Set()) {
  return itemMenuActions(
    rootEntries(roots),
    generation,
    runningFullScanRoots(roots),
    trashingRoots,
  );
}

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
      expect(actions).toEqual({ refresh: false, scanFolder: false });
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
      expect(actions).toEqual({ refresh: true, scanFolder: true });
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
    expect(actions).toEqual({ refresh: false, scanFolder: false });
  });

  it("uses the menu item's generation even when another root is busy", () => {
    const actions = menu({
      roots: [
        { root: "/other", generation: 1 } as Summary,
        { root: "/scan", generation: 2 } as Summary,
      ],
      queue: [{ root: "/other", state: "scanning", folder: null }],
    });
    expect(actions).toEqual({ refresh: true, scanFolder: true });
  });

  it("disables actions when the menu's tree was replaced or removed", () => {
    const actions = menu({
      roots: [{ root: "/scan", generation: 3 } as Summary],
      queue: [],
    });
    expect(actions).toEqual({ refresh: false, scanFolder: false });
  });

  it("disables refresh only in the root whose items move to the trash, and says why", () => {
    const roots: Roots = {
      roots: [
        { root: "/other", generation: 1 } as Summary,
        { root: "/scan", generation: 2 } as Summary,
      ],
      queue: [],
    };
    expect(menu(roots, 2, new Set(["/scan"]))).toEqual({
      refresh: false,
      scanFolder: true,
      refreshNote: "trash.busy",
    });
    expect(menu(roots, 1, new Set(["/scan"]))).toEqual({ refresh: true, scanFolder: true });
  });
});

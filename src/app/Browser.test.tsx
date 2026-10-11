import { describe, expect, it } from "vitest";
import type { Roots, Summary } from "../api/types";
import { itemMenuActions } from "./itemActions";
import { busyRoots, rootEntries, runningFullScanRoots } from "./roots";

function menu(roots: Roots, generation = 2, trashing = false) {
  return itemMenuActions(
    rootEntries(roots),
    generation,
    runningFullScanRoots(roots),
    busyRoots(roots),
    trashing,
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
      expect(actions).toEqual({ refresh: false, scanFolder: false, trash: false });
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
      expect(actions).toEqual({ refresh: true, scanFolder: true, trash: job === "queued" });
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
    expect(actions).toEqual({ refresh: false, scanFolder: false, trash: false });
  });

  it("uses the menu item's generation even when another root is busy", () => {
    const actions = menu({
      roots: [
        { root: "/other", generation: 1 } as Summary,
        { root: "/scan", generation: 2 } as Summary,
      ],
      queue: [{ root: "/other", state: "scanning", folder: null }],
    });
    expect(actions).toEqual({ refresh: true, scanFolder: true, trash: true });
  });

  it("disables actions when the menu's tree was replaced or removed", () => {
    const actions = menu({
      roots: [{ root: "/scan", generation: 3 } as Summary],
      queue: [],
    });
    expect(actions).toEqual({ refresh: false, scanFolder: false, trash: false });
  });

  it("disables only trash while a trash request runs", () => {
    const actions = menu(
      { roots: [{ root: "/scan", generation: 2 } as Summary], queue: [] },
      2,
      true,
    );
    expect(actions).toEqual({ refresh: true, scanFolder: true, trash: false });
  });
});

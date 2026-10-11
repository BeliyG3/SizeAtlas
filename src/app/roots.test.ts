import { describe, expect, it } from "vitest";
import { ROOT_ID, type Roots, type Summary } from "../api/types";
import {
  busyRoots,
  fullScanRoots,
  parseStoredRoots,
  rootEntries,
  runningFullScanRoots,
  rootsToReopen,
  storedRoots,
} from "./roots";

const summary = (root: string, generation: number): Summary => ({
  generation,
  rev: 0,
  rootId: ROOT_ID,
  root,
  total: 10,
  files: 1,
  len: 10,
  dirs: 0,
  scannedAt: 1,
  sizeMode: "Allocated",
  accessErrors: 0,
  approximate: false,
  volume: null,
});

describe("rootEntries", () => {
  it("lists open roots in order, then roots waiting for their first scan", () => {
    const roots: Roots = {
      roots: [summary("C:\\", 1), summary("D:\\", 2)],
      queue: [
        { root: "D:\\", state: "scanning", folder: null },
        { root: "E:\\", state: "queued", folder: null },
        { root: "F:\\", state: "queued", folder: null },
      ],
    };
    expect(
      rootEntries(roots).map((e) => [e.root, e.status, e.summary?.generation ?? null]),
    ).toEqual([
      ["C:\\", "open", 1],
      ["D:\\", "scanning", 2],
      ["E:\\", "queued", null],
      ["F:\\", "queued", null],
    ]);
  });

  it("shows a root queued again after a cancel once, as scanning", () => {
    const roots: Roots = {
      roots: [],
      queue: [
        { root: "E:\\", state: "scanning", folder: null },
        { root: "E:\\", state: "queued", folder: null },
      ],
    };
    expect(rootEntries(roots)).toEqual([{ root: "E:\\", summary: null, status: "scanning" }]);
  });

  it("leaves a root open while one of its folders is refreshed", () => {
    const roots: Roots = {
      roots: [summary("C:\\", 1)],
      queue: [{ root: "C:\\", state: "scanning", folder: "C:\\Users" }],
    };
    expect(rootEntries(roots).map((e) => e.status)).toEqual(["open"]);
  });
});

describe("remembered roots", () => {
  it("keep the open roots in their order, not the queued ones", () => {
    const roots: Roots = {
      roots: [summary("C:\\", 1), summary("/home/a b", 2)],
      queue: [{ root: "E:\\", state: "queued", folder: null }],
    };
    expect(parseStoredRoots(storedRoots(roots))).toEqual(["C:\\", "/home/a b"]);
  });

  it("ignore anything that is not a list of paths", () => {
    for (const raw of [null, "", "abc", "{}", '"C:\\\\"', "[1, null]"]) {
      expect(parseStoredRoots(raw)).toEqual([]);
    }
    expect(parseStoredRoots('["C:\\\\", "C:\\\\", 3, "", "D:\\\\"]')).toEqual(["C:\\", "D:\\"]);
  });

  it("fall back to the last root of a version that remembered only one", () => {
    expect(rootsToReopen(null, "T:\\")).toEqual(["T:\\"]);
    expect(rootsToReopen(null, null)).toEqual([]);
    expect(rootsToReopen("[]", "T:\\")).toEqual([]);
    expect(rootsToReopen('["C:\\\\"]', "T:\\")).toEqual(["C:\\"]);
  });
});

describe("busyRoots", () => {
  it("blocks another open root inside a full scan but keeps a sibling path available", () => {
    const roots: Roots = {
      roots: [summary("C:\\data\\sub", 1), summary("C:\\database", 2)],
      queue: [{ root: "C:\\data", state: "scanning", folder: null }],
    };
    expect([...fullScanRoots(roots)]).toEqual(["C:\\data", "C:\\data\\sub"]);
    expect(busyRoots(roots).has("C:\\database")).toBe(false);
  });
  it("blocks running jobs, including refreshes, while queued rescans allow edits", () => {
    const roots: Roots = {
      roots: [summary("C:\\", 1), summary("D:\\", 2)],
      queue: [
        { root: "C:\\", state: "scanning", folder: "C:\\Users" },
        { root: "E:\\", state: "queued", folder: null },
      ],
    };
    expect([...busyRoots(roots)]).toEqual(["C:\\"]);
  });
});

describe("runningFullScanRoots", () => {
  it("blocks running full scans and their descendants, regardless of first-scan status", () => {
    const roots: Roots = {
      roots: [summary("C:\\data", 1), summary("C:\\data\\sub", 2), summary("D:\\", 3)],
      queue: [
        { root: "C:\\data", state: "scanning", folder: null },
        { root: "D:\\", state: "queued", folder: null },
      ],
    };
    expect([...runningFullScanRoots(roots)]).toEqual(["C:\\data", "C:\\data\\sub"]);
    roots.roots[0].scanning = true;
    expect([...runningFullScanRoots(roots)]).toEqual(["C:\\data", "C:\\data\\sub"]);
  });

  it("keeps refresh and child scans enabled during a folder refresh", () => {
    expect(
      runningFullScanRoots({
        roots: [summary("C:\\", 1)],
        queue: [{ root: "C:\\", state: "scanning", folder: "C:\\Users" }],
      }).size,
    ).toBe(0);
  });
});

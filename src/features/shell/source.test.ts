import { describe, expect, it } from "vitest";
import type { CachedScan, Sources } from "../../api/types";
import {
  expectedBytes,
  forgettable,
  isDrive,
  recentFolders,
  rootLabel,
  savedScan,
  scanFraction,
  sourceAction,
  sourceLabel,
} from "./source";

const scan = (root: string, outdated = false): CachedScan => ({
  root,
  scannedAt: 1,
  total: 1,
  files: 1,
  outdated,
});

const sources: Sources = {
  disks: [
    {
      name: "System",
      mount: "C:\\",
      total: 1000,
      available: 400,
      removable: false,
      network: false,
      connected: true,
    },
  ],
  scans: [scan("C:\\"), scan("D:\\Photos"), scan("E:\\Old", true)],
};

describe("source choice", () => {
  it("rescans the selected root, opens another root or a current saved scan, scans otherwise", () => {
    const none = new Set<string>();
    expect(sourceAction("D:\\Photos", null, none, sources.scans)).toBe("open");
    expect(sourceAction("E:\\Old", null, none, sources.scans)).toBe("scan");
    expect(sourceAction("F:\\New", "C:\\", new Set(["C:\\"]), sources.scans)).toBe("scan");
    expect(sourceAction("C:\\", "C:\\", new Set(["C:\\"]), sources.scans)).toBe("rescan");
    expect(sourceAction("G:\\", "C:\\", new Set(["C:\\", "G:\\"]), sources.scans)).toBe("open");
    expect(sourceAction(null, null, none, sources.scans)).toBeNull();
  });

  it("lists recent folders without drives and finds saved scans", () => {
    expect(recentFolders(sources).map((s) => s.root)).toEqual(["D:\\Photos", "E:\\Old"]);
    expect(recentFolders(null)).toEqual([]);
    expect(savedScan(sources, "C:\\")?.outdated).toBe(false);
    expect(savedScan(sources, "Z:\\")).toBeUndefined();
  });

  it("forgets a source only if it has a saved scan, outdated ones included", () => {
    expect(forgettable(sources, "E:\\Old")).toBe("E:\\Old");
    expect(forgettable(sources, "Z:\\")).toBeNull();
    expect(forgettable(sources, null)).toBeNull();
  });

  it("expects the used space of a drive and caps the progress", () => {
    expect(expectedBytes(sources, "C:\\")).toBe(600);
    expect(expectedBytes(sources, "D:\\Photos")).toBeNull();
    expect(scanFraction(300, 600)).toBe(0.5);
    expect(scanFraction(900, 600)).toBe(1);
    expect(scanFraction(300, null)).toBeUndefined();
    expect(scanFraction(300, 0)).toBeUndefined();
  });
});

describe("rootLabel", () => {
  it("names a drive by its label and letter, anything else by its path", () => {
    expect(rootLabel(sources, "C:\\")).toBe("System (C:)");
    expect(rootLabel(sources, "D:\\Photos")).toBe("D:\\Photos");
    expect(rootLabel(null, "C:\\")).toBe("C:\\");
    const unnamed: Sources = { ...sources, disks: [{ ...sources.disks[0], name: "" }] };
    expect(rootLabel(unnamed, "C:\\")).toBe("C:\\");
    const unix: Sources = { ...sources, disks: [{ ...sources.disks[0], mount: "/" }] };
    expect(rootLabel(unix, "/")).toBe("System (/)");
  });

  it("tells a drive from a folder", () => {
    expect(isDrive(sources, "C:\\")).toBe(true);
    expect(isDrive(sources, "D:\\Photos")).toBe(false);
    expect(isDrive(null, "C:\\")).toBe(false);
  });
});

describe("sourceLabel", () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${params.root}` : key;
  const disks = [
    sources.disks[0],
    { ...sources.disks[0], name: "", mount: "Z:\\", connected: false },
  ];
  const all: Sources = { ...sources, disks };

  it("is the text of the item in the list", () => {
    expect(sourceLabel(all, "C:\\", t)).toBe("C:\\  System");
    expect(sourceLabel(all, "Z:\\", t)).toBe("Z:\\ (drives.disconnected)");
    expect(sourceLabel(all, "D:\\Photos", t)).toBe("D:\\Photos");
    expect(sourceLabel(all, "E:\\Old", t)).toBe("toolbar.outdated:E:\\Old");
  });

  it("is the path itself when the list does not have it", () => {
    expect(sourceLabel(all, "F:\\Else", t)).toBe("F:\\Else");
    expect(sourceLabel(null, "F:\\Else", t)).toBe("F:\\Else");
  });
});

import { describe, expect, it } from "vitest";
import type { CachedScan } from "../../api/types";
import { driveChoice } from "./choice";

const saved = (outdated: boolean): CachedScan => ({
  root: "C:\\",
  scannedAt: 100,
  total: 1,
  files: 1,
  outdated,
});

describe("driveChoice", () => {
  it("asks to scan a drive with no current saved scan that is not open", () => {
    expect(driveChoice(undefined, undefined)).toEqual({ kind: "scan" });
    expect(driveChoice(undefined, saved(true))).toEqual({ kind: "scan" });
  });

  it("offers to open or rescan a saved scan of this version", () => {
    expect(driveChoice(undefined, saved(false))).toEqual({ kind: "open", scannedAt: 100 });
  });

  it("offers to open or rescan an open drive, dated by its tree", () => {
    const open = { status: "open" as const, summary: { scannedAt: 200 } };
    expect(driveChoice(open, saved(false))).toEqual({ kind: "open", scannedAt: 200 });
    expect(driveChoice(open, undefined)).toEqual({ kind: "open", scannedAt: 200 });
  });

  it("only selects a drive whose scan runs or waits", () => {
    expect(driveChoice({ status: "scanning", summary: null }, undefined)).toEqual({
      kind: "select",
    });
    expect(driveChoice({ status: "queued", summary: { scannedAt: 1 } }, saved(false))).toEqual({
      kind: "select",
    });
  });
});

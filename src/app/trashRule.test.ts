import { describe, expect, it } from "vitest";
import type { Roots } from "../api/types";
import { runningJob, trashAvailability, trashNoteKey } from "./trashRule";

describe("runningJob", () => {
  it("is the running job only, not a queued one", () => {
    const job = { root: "/a", state: "scanning", folder: "/a/b" } as const;
    const roots = (state: "scanning" | "queued"): Roots => ({
      roots: [],
      queue: [{ ...job, state }],
    });
    expect(runningJob(roots("scanning"))).toEqual(job);
    expect(runningJob(roots("queued"))).toBeNull();
    expect(runningJob({ roots: [], queue: [] })).toBeNull();
  });
});

describe("trashAvailability", () => {
  it("allows the trash without a running job", () => {
    expect(trashAvailability(false, false, undefined)).toEqual({ enabled: true, reason: null });
  });
  it("refuses during another trash request, without a scan reason", () => {
    expect(trashAvailability(true, false, undefined)).toEqual({ enabled: false, reason: null });
    expect(trashAvailability(true, true, true)).toEqual({ enabled: false, reason: null });
  });
  it("waits for the backend's first answer while a job runs, then follows it", () => {
    expect(trashAvailability(false, true, undefined)).toEqual({ enabled: false, reason: null });
    expect(trashAvailability(false, true, false)).toEqual({ enabled: true, reason: null });
    expect(trashAvailability(false, true, true)).toEqual({ enabled: false, reason: "scanning" });
  });
});

describe("trashNoteKey", () => {
  it("names a folder, a file, an item of unknown kind or several items", () => {
    expect(trashNoteKey(1, true)).toBe("trash.scanningFolder");
    expect(trashNoteKey(1, false)).toBe("trash.scanningFile");
    expect(trashNoteKey(1)).toBe("trash.scanningItem");
    expect(trashNoteKey(3, true)).toBe("trash.scanningItems");
  });
});

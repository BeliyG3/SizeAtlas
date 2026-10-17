import { describe, expect, it } from "vitest";
import type { Roots } from "../api/types";
import { jobRuns, trashAvailability } from "./trashRule";

describe("jobRuns", () => {
  it("asks only while a job runs, not for queued ones", () => {
    const roots = (state: "scanning" | "queued"): Roots => ({
      roots: [],
      queue: [{ root: "/a", state, folder: null }],
    });
    expect(jobRuns(roots("scanning"))).toBe(true);
    expect(jobRuns(roots("queued"))).toBe(false);
    expect(jobRuns({ roots: [], queue: [] })).toBe(false);
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
  it("waits for the backend while a job runs, then follows it", () => {
    expect(trashAvailability(false, true, undefined)).toEqual({ enabled: false, reason: null });
    expect(trashAvailability(false, true, false)).toEqual({ enabled: true, reason: null });
    expect(trashAvailability(false, true, true)).toEqual({ enabled: false, reason: "scanning" });
  });
});

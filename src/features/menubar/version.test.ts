import { describe, expect, it } from "vitest";
import { displayVersion, isNewer, parseVersion, wixVersion } from "./version";

describe("displayVersion", () => {
  it("drops the release number of the first release of a month", () => {
    expect(displayVersion("2026.10.0")).toBe("2026.10");
    expect(displayVersion("2027.1.0")).toBe("2027.1");
  });

  it("keeps later releases of the month as they are", () => {
    expect(displayVersion("2026.10.1")).toBe("2026.10.1");
    expect(displayVersion("2026.10.10")).toBe("2026.10.10");
  });
});

describe("wixVersion", () => {
  it("keeps the last two digits of the year", () => {
    expect(wixVersion("2026.10.0")).toBe("26.10.0");
    expect(wixVersion("2027.1.12")).toBe("27.1.12");
  });
});

describe("parseVersion", () => {
  it("reads both shown forms", () => {
    expect(parseVersion("2026.10")).toEqual([2026, 10, 0]);
    expect(parseVersion("2026.10.1")).toEqual([2026, 10, 1]);
  });

  it("ignores anything else", () => {
    for (const text of [
      "",
      "v2026.10",
      "2026",
      "2026.10.1.2",
      "2026.10-beta",
      "2026.x",
      " 2026.10",
    ]) {
      expect(parseVersion(text)).toBeNull();
    }
  });
});

describe("isNewer", () => {
  it("compares the numbers, not the text", () => {
    expect(isNewer("2026.11", "2026.10.1")).toBe(true);
    expect(isNewer("2026.10.2", "2026.10.1")).toBe(true);
    expect(isNewer("2026.10.10", "2026.10.9")).toBe(true);
    expect(isNewer("2027.1", "2026.12.5")).toBe(true);
  });

  it("treats YEAR.MONTH as its first release", () => {
    expect(isNewer("2026.10", "2026.10.0")).toBe(false);
    expect(isNewer("2026.10.0", "2026.10")).toBe(false);
  });

  it("is false for the same or an older version", () => {
    expect(isNewer("2026.10.1", "2026.10.1")).toBe(false);
    expect(isNewer("2026.9.9", "2026.10")).toBe(false);
  });

  it("is false when a version cannot be read", () => {
    expect(isNewer("nightly", "2026.10.1")).toBe(false);
    expect(isNewer("2026.11", "dev")).toBe(false);
  });
});

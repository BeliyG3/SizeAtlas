import { describe, expect, it } from "vitest";
import type { InfoDto, InfoKind } from "../../api/cleanup";
import { restartOffered, visibleInfo } from "./access";

const line = (kind: InfoKind): InfoDto => ({
  kind,
  path: "p",
  size: null,
  app: null,
  command: null,
});
const info = [line("noAccess"), line("pagefile"), line("appRunning")];
const kinds = (lines: readonly InfoDto[]) => lines.map((l) => l.kind);

describe("the unreadable places among the facts", () => {
  it("are told to need administrator rights only where that is true and can be acted on", () => {
    expect(kinds(visibleInfo(info, "windows", false))).toEqual([
      "noAccess",
      "pagefile",
      "appRunning",
    ]);
  });

  it("are left to the banner as an administrator, on a Mac, elsewhere, and until known", () => {
    for (const [os, elevated] of [
      ["windows", true],
      ["windows", null],
      ["mac", false],
      ["other", false],
    ] as const)
      expect(kinds(visibleInfo(info, os, elevated)), `${os} ${elevated}`).toEqual([
        "pagefile",
        "appRunning",
      ]);
  });
});

describe("the restart button of the facts", () => {
  it("shows only where the banner does not show its own", () => {
    expect(restartOffered("windows", false, 0)).toBe(true);
    expect(restartOffered("windows", false, 3)).toBe(false);
  });

  it("is not offered to an administrator, while unknown, or off Windows", () => {
    expect(restartOffered("windows", true, 0)).toBe(false);
    expect(restartOffered("windows", null, 0)).toBe(false);
    expect(restartOffered("mac", false, 0)).toBe(false);
  });
});

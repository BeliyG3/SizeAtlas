import { describe, expect, it } from "vitest";
import { staleScan } from "./stale";

describe("a stale scan", () => {
  const DAY = 24 * 60 * 60;
  const now = 1_000 * DAY * 1000;
  const at = (ago: number) => 1_000 * DAY - ago;

  it("is one made more than a day ago", () => {
    expect(staleScan(at(DAY - 1), now)).toBe(false);
    expect(staleScan(at(DAY + 1), now)).toBe(true);
    expect(staleScan(at(30 * DAY), now)).toBe(true);
  });

  it("is not one with an unknown time or in the future", () => {
    expect(staleScan(0, now)).toBe(false);
    expect(staleScan(at(-5 * DAY), now)).toBe(false);
  });
});

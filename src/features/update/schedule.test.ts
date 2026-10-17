import { describe, expect, it } from "vitest";
import { isDue } from "./schedule";

const now = Date.UTC(2026, 9, 17, 12);
const hour = 60 * 60 * 1000;

describe("isDue", () => {
  it("checks when nothing usable is stored", () => {
    expect(isDue(null, now)).toBe(true);
    expect(isDue("", now)).toBe(true);
    expect(isDue("soon", now)).toBe(true);
  });

  it("waits a day after the last check", () => {
    expect(isDue(String(now - 23 * hour), now)).toBe(false);
    expect(isDue(String(now - 24 * hour), now)).toBe(true);
  });

  it("checks when the stored time is in the future", () => {
    expect(isDue(String(now + hour), now)).toBe(true);
  });
});

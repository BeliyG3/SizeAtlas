import { describe, expect, it } from "vitest";
import { isStale } from "./freshness";

describe("isStale", () => {
  const latest = { generation: 5, rev: 2 };
  it("drops answers from an older generation", () => {
    expect(isStale(latest, { generation: 4, rev: 9 })).toBe(true);
  });
  it("drops older revisions of the same generation", () => {
    expect(isStale(latest, { generation: 5, rev: 1 })).toBe(true);
  });
  it("keeps current and newer answers", () => {
    expect(isStale(latest, { generation: 5, rev: 2 })).toBe(false);
    expect(isStale(latest, { generation: 6, rev: 0 })).toBe(false);
  });
});

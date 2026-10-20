import { describe, expect, it } from "vitest";
import { MIN_NAME, drivesWidth } from "./fit";

describe("drives table width", () => {
  it("adds the fitted name to the number columns", () => {
    expect(drivesWidth({ name: 170, size: 62, used: 62, free: 66 })).toBe(360);
  });

  it("never counts the name narrower than its minimum", () => {
    expect(drivesWidth({ name: 40, size: 84, used: 84, free: 84 })).toBe(MIN_NAME + 252);
  });
});

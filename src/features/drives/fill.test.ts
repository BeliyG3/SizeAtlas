import { describe, expect, it } from "vitest";
import { driveFill } from "./fill";

describe("drive fill", () => {
  it("is the used share of the drive", () => {
    expect(driveFill(1000, 750)).toEqual({ used: 0.25, low: false });
  });

  it("turns low only under 10% free", () => {
    expect(driveFill(1000, 99)?.low).toBe(true);
    expect(driveFill(1000, 100)?.low).toBe(false);
    expect(driveFill(1000, 500)?.low).toBe(false);
  });

  it("has no fill for an empty size", () => {
    expect(driveFill(0, 0)).toBeNull();
  });

  it("clamps the used share into 0..1", () => {
    expect(driveFill(1000, 1500)?.used).toBe(0);
    expect(driveFill(1000, -5)?.used).toBe(1);
  });
});

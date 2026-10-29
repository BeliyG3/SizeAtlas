import { describe, expect, it } from "vitest";
import { EDGE_FADE } from "../look";
import { edgeFade } from "./edgeFade";

const { near, far, floor } = EDGE_FADE;

describe("edgeFade", () => {
  it("is 1 up to near and the floor from far on", () => {
    expect(edgeFade(0, near, far, floor)).toBe(1);
    expect(edgeFade(near, near, far, floor)).toBe(1);
    expect(edgeFade(far, near, far, floor)).toBeCloseTo(floor, 12);
    expect(edgeFade(far * 10, near, far, floor)).toBeCloseTo(floor, 12);
  });

  it("falls monotonically and stays within [floor, 1]", () => {
    let last = 1;
    for (let d = near; d <= far; d += (far - near) / 100) {
      const f = edgeFade(d, near, far, floor);
      expect(f).toBeLessThanOrEqual(last + 1e-12);
      expect(f).toBeGreaterThanOrEqual(floor - 1e-12);
      last = f;
    }
  });

  it("is smooth: flat at both ends and halfway in the middle", () => {
    const mid = (near + far) / 2;
    expect(edgeFade(mid, near, far, floor)).toBeCloseTo((1 + floor) / 2, 12);
    const eps = 1e-3;
    expect(1 - edgeFade(near + eps, near, far, floor)).toBeLessThan(1e-6);
    expect(edgeFade(far - eps, near, far, floor) - floor).toBeLessThan(1e-6);
  });

  it("uses the tunable look constants", () => {
    expect(near).toBeLessThan(far);
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(1);
  });
});

import { describe, expect, it } from "vitest";
import { FIXED, MAX_FRAME, stepsFor } from "./loop";

describe("stepsFor", () => {
  it("runs no step in a 144 Hz frame and draws that share of the way to the next", () => {
    const r = stepsFor(0, 1 / 144);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeCloseTo(60 / 144, 5);
    expect(r.acc).toBeCloseTo(1 / 144, 9);
  });

  it("clamps a long frame to MAX_FRAME: six steps, never thirty", () => {
    const r = stepsFor(0, 0.5);
    expect(r.steps).toBe(Math.round(MAX_FRAME / FIXED));
    expect(r.steps).toBe(6);
    expect(r.alpha).toBeCloseTo(0, 5);
  });

  it("carries what is left over into the next frame", () => {
    let acc = 0;
    let steps = 0;
    // 144 frames of a 144 Hz display are one second: 60 steps.
    for (let i = 0; i < 144; i++) {
      const r = stepsFor(acc, 1 / 144);
      acc = r.acc;
      steps += r.steps;
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThanOrEqual(1);
    }
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it("treats a clock that went back as no time", () => {
    expect(stepsFor(0, -1).steps).toBe(0);
  });
});

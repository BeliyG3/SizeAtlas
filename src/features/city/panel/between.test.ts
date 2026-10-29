import { describe, expect, it } from "vitest";
import { createBetween, JUMP } from "./between";

const mover = (x: number, heading: number) => ({
  x: Float32Array.of(x),
  y: Float32Array.of(0),
  z: Float32Array.of(0),
  heading: Float32Array.of(heading),
  appear: Float32Array.of(1),
});

describe("createBetween", () => {
  it("draws a mover part of the way past the step before, the short way round", () => {
    const m = mover(0, 3);
    const b = createBetween(m);
    m.x[0] = 1;
    m.heading[0] = -3; // across the back: 0.28 rad on, not 6
    const at = b.at(0.5);
    expect(at.x[0]).toBeCloseTo(0.5);
    expect(Math.abs(at.heading[0])).toBeGreaterThan(3);
    expect(at.appear).toBe(m.appear);
    expect(b.at(0.5)).toBe(at);
  });

  it("draws one put down anew where it is", () => {
    const m = mover(0, 0);
    const b = createBetween(m);
    m.x[0] = JUMP + 1;
    expect(b.at(0.2).x[0]).toBe(JUMP + 1);
    b.keep();
    m.x[0] += 0.5;
    expect(b.at(0).x[0]).toBe(JUMP + 1);
  });
});

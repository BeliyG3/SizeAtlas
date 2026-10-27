import { describe, expect, it } from "vitest";
import { frame, MAX_DISTANCE, MIN_DISTANCE, type Box } from "./frame";

const ground: Box = { min: [0, 0, 0], max: [100, 0, 100] };

describe("frame", () => {
  it("fits the ground from above with a fixed fov and aspect", () => {
    const { target, distance } = frame(ground, 60, 1, 0);
    expect(target).toEqual([50, 0, 50]);
    // Half side 50 over tan(30°), plus the 10 % margin.
    expect(distance).toBeCloseTo((50 / Math.tan(Math.PI / 6)) * 1.1, 6);
  });

  it("backs off for a narrow panel", () => {
    const wide = frame(ground, 60, 1, 0).distance;
    expect(frame(ground, 60, 0.5, 0).distance).toBeCloseTo(wide * 2, 6);
  });

  it("puts the target in the middle of the heights and fits a tall tower", () => {
    const tower: Box = { min: [0, 0, 0], max: [2, 30, 2] };
    const side = frame(tower, 60, 1.5, Math.PI / 2);
    expect(side.target).toEqual([1, 15, 1]);
    // Seen from the side the tower's half height 15 limits, its near face is 1 unit closer.
    expect(side.distance).toBeCloseTo(1 + (15 / Math.tan(Math.PI / 6)) * 1.1, 6);
  });

  it("follows the azimuth", () => {
    const strip: Box = { min: [0, 0, 0], max: [100, 0, 2] };
    const front = frame(strip, 60, 1, Math.PI / 2).distance;
    const end = frame(strip, 60, 1, Math.PI / 2, Math.PI / 2).distance;
    expect(end).toBeLessThan(front);
  });

  it("fits the whole ground in a 300 × 900 panel at the reset view", () => {
    // The scene's fov 45 and reset polar 55°; the camera's far plane is 2000.
    const { distance } = frame(ground, 45, 300 / 900, (55 * Math.PI) / 180);
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(MAX_DISTANCE);
    expect(distance + Math.hypot(100, 100)).toBeLessThan(2000);
  });

  it("clamps to the distance limits", () => {
    expect(frame({ min: [0, 0, 0], max: [0.1, 0.1, 0.1] }, 60, 1, 1).distance).toBe(MIN_DISTANCE);
    expect(frame({ min: [0, 0, 0], max: [1e4, 0, 1e4] }, 60, 1, 1).distance).toBe(MAX_DISTANCE);
  });
});

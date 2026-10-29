import { describe, expect, it } from "vitest";
import { cameraMove, frame, MIN_DISTANCE, type Box, type Vec3 } from "./frame";

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

  it("fits a 4 km island in a 300 × 900 panel at the reset view", () => {
    // The scene's fov 45 and reset polar 55°.
    const island: Box = { min: [0, 0, 0], max: [4000, 160, 4000] };
    const { distance } = frame(island, 45, 300 / 900, (55 * Math.PI) / 180);
    expect(distance).toBeGreaterThan(4000);
  });

  it("puts every corner of the largest archipelago in a narrow panel", () => {
    // 14 km across, the scene's fov 45, at the reset polar 55° and turned half way round.
    const world: Box = { min: [0, 0, 0], max: [13_500, 160, 13_500] };
    const [fov, aspect, polar] = [45, 0.4, (55 * Math.PI) / 180];
    for (const azimuth of [0, Math.PI / 4]) {
      const { target, distance } = frame(world, fov, aspect, polar, azimuth);
      const sp = Math.sin(polar);
      const back: Vec3 = [sp * Math.sin(azimuth), Math.cos(polar), sp * Math.cos(azimuth)];
      const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
      const up: Vec3 = [
        back[1] * right[2] - back[2] * right[1],
        back[2] * right[0] - back[0] * right[2],
        back[0] * right[1] - back[1] * right[0],
      ];
      const eye = target.map((t, i) => t + distance * back[i]);
      const tanV = Math.tan((fov * Math.PI) / 360);
      for (let corner = 0; corner < 8; corner++) {
        const p = [0, 1, 2].map((i) => ((corner >> i) & 1 ? world.max : world.min)[i] - eye[i]);
        const dot = (v: Vec3) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
        const depth = -dot(back);
        expect(Math.abs(dot(right)) / depth).toBeLessThanOrEqual(tanV * aspect + 1e-9);
        expect(Math.abs(dot(up)) / depth).toBeLessThanOrEqual(tanV + 1e-9);
      }
    }
  });

  it("keeps to the least distance", () => {
    expect(frame({ min: [0, 0, 0], max: [0.1, 0.1, 0.1] }, 60, 1, 1).distance).toBe(MIN_DISTANCE);
  });
});

describe("cameraMove", () => {
  const on = (generation: number, islands: number[]) => ({ generation, islands });

  it("jumps onto the root's island the first time a world shows", () => {
    expect(cameraMove(null, on(4, [3, 4]))).toBe("jump");
  });

  it("flies to the island of another selected root that was shown", () => {
    expect(cameraMove(on(4, [3, 4, 5]), on(5, [3, 4, 5]))).toBe("fly");
  });

  it("stays put while the same root is rebuilt, even if the islands changed", () => {
    expect(cameraMove(on(4, [3, 4]), on(4, [3, 4]))).toBe("stay");
    expect(cameraMove(on(4, [3, 4]), on(4, [2, 3, 4]))).toBe("stay");
  });

  it("jumps for another root that is no island", () => {
    expect(cameraMove(on(4, [3, 4]), on(6, [3, 4]))).toBe("jump");
  });

  it("jumps to a root whose island was not shown: the map is another", () => {
    // From the drives to a folder of its own, and back.
    expect(cameraMove(on(4, [3, 4]), on(9, [9]))).toBe("jump");
    expect(cameraMove(on(9, [9]), on(4, [3, 4]))).toBe("jump");
  });
});

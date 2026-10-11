import { describe, expect, it } from "vitest";
import type { Item } from "../../api/types";
import { PALETTES } from "../../palette";
import { arcPath, buildSlices } from "./slices";

const item = (id: number, size: number, isDir = false): Item => ({
  id,
  name: `n${id}`,
  size,
  len: size,
  files: 1,
  dirs: 0,
  folders: 0,
  modified: 0,
  isDir,
  category: 7,
  accessError: false,
  cloud: false,
  lossy: false,
});

describe("buildSlices", () => {
  it("gives each child its share and adds the rest as Other", () => {
    const slices = buildSlices([item(1, 60, true), item(2, 20)], 20, PALETTES.dark, "Other");
    expect(slices.map((s) => [s.id, s.start, s.share])).toEqual([
      [1, 0, 0.6],
      [2, 0.6, 0.2],
      [null, 0.8, 0.2],
    ]);
    expect(slices[0].color).toBe(PALETTES.dark.slices[0]);
    expect(slices[2]).toMatchObject({ name: "Other", color: PALETTES.dark.other });
  });

  it("skips empty children and empty folders", () => {
    expect(buildSlices([item(1, 0)], 0, PALETTES.dark, "Other")).toEqual([]);
    const slices = buildSlices([item(1, 10), item(2, 0)], 0, PALETTES.light, "Other");
    expect(slices.map((s) => s.id)).toEqual([1]);
  });
});

describe("arcPath", () => {
  it("draws slices clockwise from the top", () => {
    expect(arcPath(50, 50, 40, 0, 0.25)).toBe("M 50 50 L 50 10 A 40 40 0 0 1 90 50 Z");
    expect(arcPath(50, 50, 40, 0, 0.75)).toBe("M 50 50 L 50 10 A 40 40 0 1 1 10 50 Z");
  });

  it("draws a whole circle in two halves", () => {
    expect(arcPath(50, 50, 40, 0, 1)).toBe("M 10 50 A 40 40 0 1 1 90 50 A 40 40 0 1 1 10 50 Z");
  });
});

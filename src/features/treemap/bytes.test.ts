import { describe, expect, it } from "vitest";
import { hitTest, parseTreemap, type TreemapRect } from "./bytes";

// Written by `encoding_matches_the_wire_format` in core/src/treemap/tests.rs.
const GOLDEN = new Uint8Array([
  7, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0xc0, 0x3f, 0, 0, 0,
  0x40, 0, 0, 0x40, 0x40, 0, 0, 0x80, 0x40, 4, 3, 2, 1, 3, 1, 0, 0,
]);

const rect = (
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  isDir = false,
): TreemapRect => ({
  x,
  y,
  w,
  h,
  id,
  category: isDir ? 255 : 7,
  depth: 0,
  isDir,
});

describe("parseTreemap", () => {
  it("decodes the bytes written by the core", () => {
    expect(parseTreemap(GOLDEN.buffer)).toEqual({
      generation: 7,
      rev: 9,
      approximate: true,
      rects: [{ x: 1.5, y: 2, w: 3, h: 4, id: 0x01020304, category: 3, depth: 1, isDir: false }],
    });
  });

  it("rejects truncated responses", () => {
    expect(() => parseTreemap(GOLDEN.slice(0, 40).buffer)).toThrow();
    expect(() => parseTreemap(GOLDEN.slice(0, 10).buffer)).toThrow();
  });
});

describe("hitTest", () => {
  const rects = [rect(1, 0, 0, 100, 100, true), rect(2, 10, 10, 20, 20)];

  it("finds the innermost rectangle", () => {
    expect(hitTest(rects, 15, 15)?.id).toBe(2);
    expect(hitTest(rects, 50, 50)?.id).toBe(1);
    expect(hitTest(rects, 150, 50)).toBeUndefined();
  });
});

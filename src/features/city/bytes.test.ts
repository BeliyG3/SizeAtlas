import { describe, expect, it } from "vitest";
import { CITY_RECORD_LEN, HEADER_LEN, parseCity } from "./bytes";

function build(
  records: {
    id: number;
    isDir: boolean;
    expanded: boolean;
    size: bigint;
    category?: number;
    depth?: number;
  }[],
  generation = 7n,
  rev = 9n,
): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_LEN + records.length * CITY_RECORD_LEN);
  const view = new DataView(buffer);
  view.setBigUint64(0, generation, true);
  view.setBigUint64(8, rev, true);
  view.setUint32(16, records.length, true);
  view.setUint8(20, 1);
  records.forEach((r, i) => {
    const at = HEADER_LEN + i * CITY_RECORD_LEN;
    [1.5, 2, 3, 4].forEach((v, k) => view.setFloat32(at + k * 4, v, true));
    view.setUint32(at + 16, r.id, true);
    view.setUint8(at + 20, r.category ?? 3);
    view.setUint8(at + 21, r.depth ?? 1);
    view.setUint8(at + 22, r.isDir ? 1 : 0);
    view.setUint8(at + 23, r.expanded ? 1 : 0);
    view.setBigUint64(at + 24, r.size, true);
  });
  return buffer;
}

describe("parseCity", () => {
  it("round-trips records with sizes and the expanded flag", () => {
    const data = parseCity(
      build([
        { id: 0x01020304, isDir: true, expanded: true, size: 1000n, category: 3, depth: 1 },
        { id: 2, isDir: false, expanded: false, size: 5n, category: 6, depth: 4 },
      ]),
    );
    expect(data).toEqual({
      generation: 7,
      rev: 9,
      approximate: true,
      rects: [
        {
          x: 1.5,
          y: 2,
          w: 3,
          h: 4,
          id: 0x01020304,
          category: 3,
          depth: 1,
          isDir: true,
          expanded: true,
          size: 1000,
        },
        {
          x: 1.5,
          y: 2,
          w: 3,
          h: 4,
          id: 2,
          category: 6,
          depth: 4,
          isDir: false,
          expanded: false,
          size: 5,
        },
      ],
    });
  });

  it("keeps sizes above 2^32 exact", () => {
    const size = 5n * 2n ** 40n + 12345n;
    const [rect] = parseCity(build([{ id: 1, isDir: false, expanded: false, size }])).rects;
    expect(rect.size).toBe(Number(size));
  });

  it("rejects truncated responses", () => {
    const bytes = build([{ id: 1, isDir: false, expanded: false, size: 1n }]);
    expect(() => parseCity(bytes.slice(0, HEADER_LEN + CITY_RECORD_LEN - 1))).toThrow();
    expect(() => parseCity(bytes.slice(0, 10))).toThrow();
  });
});

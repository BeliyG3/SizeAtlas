import { describe, expect, it } from "vitest";
import { encodeCity } from "./lots.fixture";
import { inset, LOT, parseCity, type Lot } from "./lots";

const lots: Lot[] = [
  { x: 0, z: 0, w: 200, d: 100, id: 1, kind: LOT.district, depth: 0, size: 5_000_000_000 },
  { x: 15, z: 15.5, w: 50, d: 25.25, id: 7, kind: LOT.building, depth: 2, size: 1234 },
];

describe("parseCity", () => {
  it("reads the header, the field and every record", () => {
    const city = parseCity(encodeCity(lots, 256, { generation: 3, rev: 9, approximate: true }));
    expect(city).toEqual({ generation: 3, rev: 9, approximate: true, field: 256, lots });
  });

  it("throws on a short or truncated response", () => {
    expect(() => parseCity(new ArrayBuffer(10))).toThrow(/short/);
    expect(() => parseCity(encodeCity(lots, 256).slice(0, 32 + 40))).toThrow(/truncated/);
  });

  it("throws on another format version", () => {
    expect(() => parseCity(encodeCity(lots, 256, { format: 1 }))).toThrow(/format/);
  });
});

describe("inset", () => {
  it("follows the depth", () => {
    expect([inset(0), inset(1), inset(2), inset(5)]).toEqual([15, 9, 1, 1]);
  });
});

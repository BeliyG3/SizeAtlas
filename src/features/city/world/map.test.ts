import { describe, expect, it } from "vitest";
import { CITY_HEADER_LEN, POLY, ROAD, parseCity, type CityMap } from "./map";
import { encodeCity } from "./map.fixture";

const map: CityMap = {
  generation: 7,
  rev: 8,
  approximate: true,
  width: 300.5,
  height: 200.25,
  polys: [
    {
      kind: POLY.island,
      id: 1,
      parent: 1,
      size: 2 ** 40 + 5,
      points: new Float32Array([0, 0, 10, 0, 10, 10]),
    },
    {
      kind: POLY.house,
      id: 9,
      parent: 4,
      size: 1234,
      points: new Float32Array([1, 1, 2, 1, 2, 2, 1, 2.5]),
    },
  ],
  nodes: new Float32Array([3, 4, 5, 6, 7.5, 8.5]),
  edges: [
    { a: 0, b: 1, cls: ROAD.highway, bridge: false },
    { a: 1, b: 2, cls: ROAD.lane, bridge: true },
  ],
  gates: [
    { node: 2, dx: 0, dz: -1, neighbour: 4 },
    { node: 0, dx: 1, dz: 0, neighbour: 0xffffffff },
  ],
};

describe("parseCity", () => {
  it("reads every section", () => {
    expect(parseCity(encodeCity(map))).toEqual(map);
  });

  it("throws on a short or truncated response", () => {
    const bytes = encodeCity(map);
    expect(() => parseCity(bytes.slice(0, CITY_HEADER_LEN - 1))).toThrow("too short");
    expect(() => parseCity(bytes.slice(0, bytes.byteLength - 1))).toThrow("truncated");
  });

  it("throws on another format version", () => {
    const bytes = encodeCity(map);
    new DataView(bytes).setUint32(24, 2, true);
    expect(() => parseCity(bytes)).toThrow("format 2");
  });
});

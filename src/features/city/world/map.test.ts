import { describe, expect, it } from "vitest";
import { BRIDGE_RISE, CITY_HEADER_LEN, POLY, ROAD, parseCity, type CityMap } from "./map";
import { encodeCity } from "./map.fixture";
// Written by core/src/city/encode_tests.rs (`the_frontend_fixture_is_what_the_encoder_writes`).
import golden from "./__fixtures__/city.hex?raw";

/** The bytes of a hex text, whitespace ignored. */
function bytesOf(hex: string): ArrayBuffer {
  const digits = hex.replace(/\s+/g, "");
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(2 * i, 2 * i + 2), 16);
  return out.buffer;
}

const map: CityMap = {
  generation: 7,
  rev: 8,
  build: 9,
  approximate: true,
  width: 300.5,
  height: 200.25,
  polys: [
    {
      island: 0,
      kind: POLY.island,
      id: 1,
      parent: 1,
      size: 2 ** 40 + 5,
      points: new Float32Array([0, 0, 10, 0, 10, 10]),
    },
    {
      island: 0,
      kind: POLY.house,
      id: 9,
      parent: 4,
      size: 1234,
      points: new Float32Array([1, 1, 2, 1, 2, 2, 1, 2.5]),
    },
  ],
  nodes: new Float32Array([3, 4, 5, 6, 7.5, 8.5]),
  edges: [
    { a: 0, b: 1, cls: ROAD.highway, bridge: false, liftA: 0, liftB: 0 },
    { a: 1, b: 2, cls: ROAD.lane, bridge: true, liftA: BRIDGE_RISE, liftB: BRIDGE_RISE },
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

  it("reads what the Rust encoder writes", () => {
    const city = parseCity(bytesOf(golden));
    expect([city.generation, city.rev, city.build, city.approximate]).toEqual([42, 7, 0, true]);
    expect([city.width, city.height]).toEqual([120.5, 96.75]);
    // Every kind, in the encoder's order; odd ones are quads.
    expect(city.polys.map((p) => p.kind)).toEqual([
      POLY.island,
      POLY.water,
      POLY.land,
      POLY.district,
      POLY.block,
      POLY.house,
      POLY.filler,
      POLY.square,
      POLY.plaza,
      POLY.vacant,
    ]);
    city.polys.forEach((p, k) => {
      expect([p.id, p.parent, p.size]).toEqual([100 + k, 99 + k, 5 * 2 ** 32 + k]);
      expect(p.points.length).toBe(k % 2 ? 8 : 6);
      expect(Array.from(p.points.slice(2, 6))).toEqual([
        k * 10 + 8.5,
        k * 10,
        k * 10 + 8.5,
        k * 10 + 6.25,
      ]);
    });
    expect(city.nodes.length).toBe(12);
    expect(Array.from(city.nodes.slice(10))).toEqual([62.5, 45]);
    expect(city.edges.map((e) => [e.a, e.b, e.cls, e.bridge])).toEqual([
      [0, 1, ROAD.highway, false],
      [1, 2, ROAD.ring, false],
      [2, 3, ROAD.ramp, false],
      [3, 4, ROAD.street, true],
      [4, 5, ROAD.lane, false],
    ]);
    expect(city.gates).toEqual([
      { node: 0, dx: -1, dz: 0, neighbour: 3 },
      { node: 5, dx: Math.fround(0.6), dz: Math.fround(-0.8), neighbour: 0xffffffff },
    ]);
  });

  it("throws on another format version", () => {
    const bytes = encodeCity(map);
    new DataView(bytes).setUint32(24, 2, true);
    expect(() => parseCity(bytes)).toThrow("format 2");
  });
});

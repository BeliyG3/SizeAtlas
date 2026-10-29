import {
  CITY_FORMAT,
  CITY_HEADER_LEN,
  EDGE_LEN,
  GATE_LEN,
  POINT_LEN,
  POLY_LEN,
  type CityMap,
  type Poly,
  type PolyKind,
} from "./map";

/** A `get_city` response for `map`, byte for byte as core/src/city/encode.rs writes it; for tests. */
export function encodeCity(map: CityMap): ArrayBuffer {
  const pointCount = map.polys.reduce((sum, p) => sum + p.points.length / 2, 0);
  const nodeCount = map.nodes.length / 2;
  const total =
    CITY_HEADER_LEN +
    POLY_LEN * map.polys.length +
    POINT_LEN * (pointCount + nodeCount) +
    EDGE_LEN * map.edges.length +
    GATE_LEN * map.gates.length;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(map.generation), true);
  view.setBigUint64(8, BigInt(map.rev), true);
  view.setUint32(16, map.polys.length, true);
  view.setUint8(20, map.approximate ? 1 : 0);
  view.setUint32(24, CITY_FORMAT, true);
  view.setFloat32(28, map.width, true);
  view.setFloat32(32, map.height, true);
  view.setUint32(36, pointCount, true);
  view.setUint32(40, nodeCount, true);
  view.setUint32(44, map.edges.length, true);
  view.setUint32(48, map.gates.length, true);
  view.setUint32(52, map.build, true);
  let at = CITY_HEADER_LEN;
  for (const p of map.polys) {
    view.setUint8(at, p.kind);
    view.setUint16(at + 2, p.points.length / 2, true);
    view.setUint32(at + 4, p.id, true);
    view.setUint32(at + 8, p.parent, true);
    view.setBigUint64(at + 16, BigInt(p.size), true);
    at += POLY_LEN;
  }
  const floats = (values: ArrayLike<number>) => {
    for (let i = 0; i < values.length; i++, at += 4) view.setFloat32(at, values[i], true);
  };
  for (const p of map.polys) floats(p.points);
  floats(map.nodes);
  for (const e of map.edges) {
    view.setUint32(at, e.a, true);
    view.setUint32(at + 4, e.b, true);
    view.setUint8(at + 8, e.cls);
    view.setUint8(at + 9, e.bridge ? 1 : 0);
    at += EDGE_LEN;
  }
  for (const g of map.gates) {
    view.setUint32(at, g.node, true);
    view.setFloat32(at + 4, g.dx, true);
    view.setFloat32(at + 8, g.dz, true);
    view.setUint32(at + 12, g.neighbour, true);
    at += GATE_LEN;
  }
  return buffer;
}

/** A square polygon with its corner at (`x`, `z`), counter-clockwise by the shoelace formula. */
export function square(
  kind: PolyKind,
  id: number,
  parent: number,
  size: number,
  x = 0,
  z = 0,
  side = 10,
): Poly {
  const points = new Float32Array([x, z, x + side, z, x + side, z + side, x, z + side]);
  return { island: 0, kind, id, parent, size, points };
}

/** A map of the given polygons with no roads, for tests. */
export function mapOf(polys: Poly[], extra: Partial<CityMap> = {}): CityMap {
  return {
    generation: 1,
    rev: 1,
    build: 0,
    approximate: false,
    width: 100,
    height: 100,
    polys,
    nodes: new Float32Array(0),
    edges: [],
    gates: [],
    ...extra,
  };
}

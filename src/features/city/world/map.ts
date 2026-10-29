/**
 * The island map (city format 3) as the frontend reads it; pure, no three.js. All little-endian;
 * the layout must match core/src/city/encode.rs: the 24-byte header shared with the treemap
 * (`count` = number of polygons), then `u32 format | f32 width | f32 height | u32 points |
 * u32 nodes | u32 edges | u32 gates | u32 0` (56 bytes in all); the polygons, 24 bytes each:
 * `u8 kind | u8 0 | u16 points | u32 id | u32 parent | u32 0 | u64 size`; all their points in
 * polygon order, 8 bytes each: `f32 x, y`; the nodes, 8 bytes each; the edges, 12 bytes each:
 * `u32 a | u32 b | u8 class | u8 bridge | u16 0`; the gates, 16 bytes each:
 * `u32 node | f32 dx | f32 dy | u32 neighbour`.
 *
 * The map's second axis `y` is the front's `z`. Polygons wind with a positive signed area by
 * the shoelace formula on (x, z) as stored.
 */
export const CITY_FORMAT = 3;
export const CITY_HEADER_LEN = 56;
export const POLY_LEN = 24;
export const POINT_LEN = 8;
export const EDGE_LEN = 12;
export const GATE_LEN = 16;

/** The kinds of polygon; must match core/src/city. */
export const POLY = {
  island: 0,
  land: 1,
  district: 2,
  block: 3,
  house: 4,
  filler: 5,
  square: 6,
  plaza: 7,
  vacant: 8,
  water: 9,
} as const;
export type PolyKind = (typeof POLY)[keyof typeof POLY];

/** The classes of road; must match core/src/city. */
export const ROAD = { highway: 0, ring: 1, ramp: 2, street: 3, lane: 4 } as const;
export type RoadKind = (typeof ROAD)[keyof typeof ROAD];

/** Road widths in metres by class; must match core/src/city. */
export const ROAD_WIDTH = [16, 16, 16, 10, 5];

/** A canal bridge's deck stands this high over the ground, metres; also where a bridge between islands leaves a gate. */
export const BRIDGE_RISE = 1;

/**
 * `id` and `parent` are folder ids (ids repeat across levels: a district, its filler block and
 * the filler share one); the root's children have `parent` = the root. `points` is
 * `x0, z0, x1, z1, …`.
 */
export interface Poly {
  /** Index of the island this polygon belongs to: 0 on a parsed map, the part's index after `mergeIslands`. */
  island: number;
  kind: PolyKind;
  id: number;
  parent: number;
  size: number;
  points: Float32Array;
}

export interface MapEdge {
  a: number;
  b: number;
  cls: RoadKind;
  bridge: boolean;
  /** Metres the road stands over the ground at node `a` and at node `b`; they differ on a ramp. */
  liftA: number;
  liftB: number;
}

/** `neighbour` is the first neighbouring island's index, 0xFFFFFFFF for none. */
export interface Gate {
  node: number;
  dx: number;
  dz: number;
  neighbour: number;
  /** A bridge to another island starts here (set by `mergeIslands`): no stub over the sea. */
  bridged?: boolean;
}

export interface CityMap {
  generation: number;
  rev: number;
  approximate: boolean;
  width: number;
  height: number;
  /**
   * Where the map's corner (0, 0) lies in the archipelago's world metres; set by
   * `mergeIslands`, absent (the corner is the origin) on a parsed island.
   */
  origin?: [number, number];
  polys: Poly[];
  /** `x0, z0, x1, z1, …` */
  nodes: Float32Array;
  edges: MapEdge[];
  gates: Gate[];
}

export function parseCity(buffer: ArrayBuffer): CityMap {
  if (buffer.byteLength < CITY_HEADER_LEN) throw new Error("city response is too short");
  const view = new DataView(buffer);
  const format = view.getUint32(24, true);
  if (format !== CITY_FORMAT) throw new Error(`unsupported city format ${format}`);
  const polyCount = view.getUint32(16, true);
  const pointCount = view.getUint32(36, true);
  const nodeCount = view.getUint32(40, true);
  const edgeCount = view.getUint32(44, true);
  const gateCount = view.getUint32(48, true);
  const pointsAt = CITY_HEADER_LEN + polyCount * POLY_LEN;
  const nodesAt = pointsAt + pointCount * POINT_LEN;
  const edgesAt = nodesAt + nodeCount * POINT_LEN;
  const gatesAt = edgesAt + edgeCount * EDGE_LEN;
  if (buffer.byteLength < gatesAt + gateCount * GATE_LEN) {
    throw new Error("city response is truncated");
  }
  const floats = (at: number, count: number) => {
    const out = new Float32Array(count * 2);
    for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(at + i * 4, true);
    return out;
  };
  const polys: Poly[] = [];
  let point = 0;
  for (let i = 0; i < polyCount; i++) {
    const at = CITY_HEADER_LEN + i * POLY_LEN;
    const n = view.getUint16(at + 2, true);
    polys.push({
      island: 0,
      kind: view.getUint8(at) as PolyKind,
      id: view.getUint32(at + 4, true),
      parent: view.getUint32(at + 8, true),
      size: Number(view.getBigUint64(at + 16, true)),
      points: floats(pointsAt + point * POINT_LEN, n),
    });
    point += n;
  }
  if (point !== pointCount) throw new Error("city polygons disagree with the point count");
  const edges: MapEdge[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const at = edgesAt + i * EDGE_LEN;
    const bridge = view.getUint8(at + 9) !== 0;
    const lift = bridge ? BRIDGE_RISE : 0;
    edges.push({
      a: view.getUint32(at, true),
      b: view.getUint32(at + 4, true),
      cls: view.getUint8(at + 8) as RoadKind,
      bridge,
      liftA: lift,
      liftB: lift,
    });
  }
  const gates: Gate[] = [];
  for (let i = 0; i < gateCount; i++) {
    const at = gatesAt + i * GATE_LEN;
    gates.push({
      node: view.getUint32(at, true),
      dx: view.getFloat32(at + 4, true),
      dz: view.getFloat32(at + 8, true),
      neighbour: view.getUint32(at + 12, true),
    });
  }
  return {
    // BigInt to number: generations and revisions stay far below 2^53.
    generation: Number(view.getBigUint64(0, true)),
    rev: Number(view.getBigUint64(8, true)),
    approximate: view.getUint8(20) !== 0,
    width: view.getFloat32(28, true),
    height: view.getFloat32(32, true),
    polys,
    nodes: floats(nodesAt, nodeCount),
    edges,
    gates,
  };
}

/** Wire format v2 of `get_city`, all little-endian; must match core/src/treemap/city.rs. */
export const CITY_HEADER_LEN = 32;
export const CITY_RECORD_LEN = 32;
export const CITY_FORMAT = 2;

/** Road widths in metres; must match core/src/treemap/city.rs. */
export const HIGHWAY = 24;
export const STREET = 12;
export const SIDEWALK = 3;
export const ALLEY = 2;

export const LOT = { district: 0, block: 1, building: 2, annex: 3, others: 4 } as const;
export type LotKind = (typeof LOT)[keyof typeof LOT];

export interface Lot {
  /** Corner of the lot (the `y` of the Rust layout is `z` here), metres. */
  x: number;
  z: number;
  w: number;
  d: number;
  id: number;
  kind: LotKind;
  depth: number;
  /** Bytes; exact up to 2^53. */
  size: number;
}

export interface CityLayout {
  generation: number;
  rev: number;
  approximate: boolean;
  /** Side of the square field the city stands on, metres. */
  field: number;
  /** Parents before their children. */
  lots: Lot[];
}

/** Road room a lot of `depth` keeps between its edge and its children. */
export function inset(depth: number): number {
  if (depth === 0) return HIGHWAY / 2 + SIDEWALK;
  if (depth === 1) return STREET / 2 + SIDEWALK;
  return ALLEY / 2;
}

export function parseCity(buffer: ArrayBuffer): CityLayout {
  if (buffer.byteLength < CITY_HEADER_LEN) throw new Error("city response is too short");
  const view = new DataView(buffer);
  const format = view.getUint32(28, true);
  if (format !== CITY_FORMAT) throw new Error(`unsupported city format ${format}`);
  const count = view.getUint32(16, true);
  if (buffer.byteLength < CITY_HEADER_LEN + count * CITY_RECORD_LEN) {
    throw new Error("city response is truncated");
  }
  const lots: Lot[] = [];
  for (let i = 0; i < count; i++) {
    const at = CITY_HEADER_LEN + i * CITY_RECORD_LEN;
    lots.push({
      x: view.getFloat32(at, true),
      z: view.getFloat32(at + 4, true),
      w: view.getFloat32(at + 8, true),
      d: view.getFloat32(at + 12, true),
      id: view.getUint32(at + 16, true),
      kind: view.getUint8(at + 20) as LotKind,
      depth: view.getUint8(at + 21),
      size: Number(view.getBigUint64(at + 24, true)),
    });
  }
  return {
    // BigInt to number: generations and revisions stay far below 2^53.
    generation: Number(view.getBigUint64(0, true)),
    rev: Number(view.getBigUint64(8, true)),
    approximate: view.getUint8(20) !== 0,
    field: view.getFloat32(24, true),
    lots,
  };
}

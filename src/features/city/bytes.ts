import { HEADER_LEN, type TreemapRect } from "../treemap/bytes";

/** Wire format of `get_city`, all little-endian; must match core/src/treemap/city.rs. */
export { HEADER_LEN };
export const CITY_RECORD_LEN = 32;

export interface CityRect extends TreemapRect {
  /** Bytes; exact up to 2^53. */
  size: number;
  /** A folder with laid-out children; false for a folder drawn as one solid block. */
  expanded: boolean;
}

export interface CityData {
  generation: number;
  rev: number;
  approximate: boolean;
  /** Parents before their children. */
  rects: CityRect[];
}

export function parseCity(buffer: ArrayBuffer): CityData {
  if (buffer.byteLength < HEADER_LEN) throw new Error("city response is too short");
  const view = new DataView(buffer);
  const count = view.getUint32(16, true);
  if (buffer.byteLength < HEADER_LEN + count * CITY_RECORD_LEN) {
    throw new Error("city response is truncated");
  }
  const rects: CityRect[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_LEN + i * CITY_RECORD_LEN;
    rects.push({
      x: view.getFloat32(at, true),
      y: view.getFloat32(at + 4, true),
      w: view.getFloat32(at + 8, true),
      h: view.getFloat32(at + 12, true),
      id: view.getUint32(at + 16, true),
      category: view.getUint8(at + 20),
      depth: view.getUint8(at + 21),
      isDir: view.getUint8(at + 22) !== 0,
      expanded: view.getUint8(at + 23) !== 0,
      size: Number(view.getBigUint64(at + 24, true)),
    });
  }
  return {
    // BigInt to number: generations and revisions stay far below 2^53.
    generation: Number(view.getBigUint64(0, true)),
    rev: Number(view.getBigUint64(8, true)),
    approximate: view.getUint8(20) !== 0,
    rects,
  };
}

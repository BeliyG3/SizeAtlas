import { CITY_FORMAT, CITY_HEADER_LEN, CITY_RECORD_LEN, type Lot } from "./lots";

export interface CityHeader {
  generation?: number;
  rev?: number;
  approximate?: boolean;
  format?: number;
}

/** A `get_city` response in the v2 format, for tests. */
export function encodeCity(lots: Lot[], field: number, header: CityHeader = {}): ArrayBuffer {
  const buffer = new ArrayBuffer(CITY_HEADER_LEN + lots.length * CITY_RECORD_LEN);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(header.generation ?? 1), true);
  view.setBigUint64(8, BigInt(header.rev ?? 1), true);
  view.setUint32(16, lots.length, true);
  view.setUint8(20, header.approximate ? 1 : 0);
  view.setFloat32(24, field, true);
  view.setUint32(28, header.format ?? CITY_FORMAT, true);
  lots.forEach((lot, i) => {
    const at = CITY_HEADER_LEN + i * CITY_RECORD_LEN;
    view.setFloat32(at, lot.x, true);
    view.setFloat32(at + 4, lot.z, true);
    view.setFloat32(at + 8, lot.w, true);
    view.setFloat32(at + 12, lot.d, true);
    view.setUint32(at + 16, lot.id, true);
    view.setUint8(at + 20, lot.kind);
    view.setUint8(at + 21, lot.depth);
    view.setBigUint64(at + 24, BigInt(lot.size), true);
  });
  return buffer;
}

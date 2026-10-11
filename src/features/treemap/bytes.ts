/** Wire format of `get_treemap`, all little-endian; must match core/src/treemap. */
export const HEADER_LEN = 24;
export const RECORD_LEN = 24;

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  id: number;
  category: number;
  depth: number;
  isDir: boolean;
}

export interface TreemapData {
  generation: number;
  rev: number;
  approximate: boolean;
  /** Parents before their children. */
  rects: TreemapRect[];
}

export function parseTreemap(buffer: ArrayBuffer): TreemapData {
  if (buffer.byteLength < HEADER_LEN) throw new Error("treemap response is too short");
  const view = new DataView(buffer);
  const count = view.getUint32(16, true);
  if (buffer.byteLength < HEADER_LEN + count * RECORD_LEN) {
    throw new Error("treemap response is truncated");
  }
  const rects: TreemapRect[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_LEN + i * RECORD_LEN;
    rects.push({
      x: view.getFloat32(at, true),
      y: view.getFloat32(at + 4, true),
      w: view.getFloat32(at + 8, true),
      h: view.getFloat32(at + 12, true),
      id: view.getUint32(at + 16, true),
      category: view.getUint8(at + 20),
      depth: view.getUint8(at + 21),
      isDir: view.getUint8(at + 22) !== 0,
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

/** The innermost rectangle under a point: children always come after their folders. */
export function hitTest(
  rects: readonly TreemapRect[],
  x: number,
  y: number,
): TreemapRect | undefined {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  }
  return undefined;
}

/** A uniform grid over the map whose cells list the shapes reaching them; pure, no three.js. */

/** A cell's side, metres. */
export const CELL = 32;

/** The shapes over cell `c` are `items[start[c]]` … `items[start[c + 1] - 1]`. */
export interface Bins {
  nx: number;
  nz: number;
  start: Int32Array;
  items: Int32Array;
}

/** The cell (`nx` × `nz` of `CELL` metres from the origin) of (x, z), or -1 off the grid. */
export function cellAt(b: Bins, x: number, z: number): number {
  const i = Math.floor(x / CELL);
  const j = Math.floor(z / CELL);
  return i < 0 || j < 0 || i >= b.nx || j >= b.nz ? -1 : j * b.nx + i;
}

/** The shapes' boxes (`minX, minZ, maxX, maxZ` each) on an `nx` × `nz` grid. */
export function binBoxes(boxes: Float64Array, nx: number, nz: number): Bins {
  const count = boxes.length / 4;
  const start = new Int32Array(nx * nz + 1);
  const span = (k: number, fill: (cell: number) => void) => {
    const clampTo = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v / CELL)));
    const [i0, i1] = [clampTo(boxes[k * 4], nx), clampTo(boxes[k * 4 + 2], nx)];
    const [j0, j1] = [clampTo(boxes[k * 4 + 1], nz), clampTo(boxes[k * 4 + 3], nz)];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fill(j * nx + i);
  };
  for (let k = 0; k < count; k++) span(k, (c) => start[c + 1]++);
  for (let c = 0; c < nx * nz; c++) start[c + 1] += start[c];
  const items = new Int32Array(start[nx * nz]);
  const next = start.slice(0, nx * nz);
  for (let k = 0; k < count; k++) span(k, (c) => (items[next[c]++] = k));
  return { nx, nz, start, items };
}

/** The boxes of polygons (`x0, z0, x1, z1, …` each), as `binBoxes` takes them. */
export function polyBoxes(polys: readonly Float32Array[]): Float64Array {
  const boxes = new Float64Array(polys.length * 4);
  polys.forEach((p, k) => {
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]);
      x1 = Math.max(x1, p[i]);
      z0 = Math.min(z0, p[i + 1]);
      z1 = Math.max(z1, p[i + 1]);
    }
    boxes.set([x0, z0, x1, z1], k * 4);
  });
  return boxes;
}

/** Whether (x, z) is inside the polygon `p` (`x0, z0, …`, any winding, even-odd). */
export function insidePoly(p: Float32Array, x: number, z: number): boolean {
  let inside = false;
  for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
    const za = p[a + 1];
    const zb = p[b + 1];
    if (za > z !== zb > z && x < p[b] + ((z - zb) / (za - zb)) * (p[a] - p[b])) inside = !inside;
  }
  return inside;
}

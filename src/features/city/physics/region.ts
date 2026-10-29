/**
 * An even-odd region of polygons (the land, the canals) with its outline's edges binned on the
 * grid, so a point is placed by the few edges of its cell, not by the whole coastline; pure.
 *
 * Each cell knows whether its corner (least x and z) is inside. A point is inside when the way
 * from its cell's corner to it, up the cell's left side and then along its row, crosses the
 * outline an odd number of times more.
 */
import { CELL, binBoxes, cellAt, type Bins } from "./bins";

export interface Region {
  bins: Bins;
  /** `xa, za, xb, zb` per edge. */
  edges: Float64Array;
  /** 1 where the cell's corner is inside. */
  corner: Uint8Array;
}

export function createRegion(polys: readonly Float32Array[], nx: number, nz: number): Region {
  const count = polys.reduce((n, p) => n + p.length / 2, 0);
  const edges = new Float64Array(count * 4);
  const boxes = new Float64Array(count * 4);
  let e = 0;
  for (const p of polys) {
    for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2, e += 4) {
      edges.set([p[b], p[b + 1], p[a], p[a + 1]], e);
      boxes.set(
        [
          Math.min(p[a], p[b]),
          Math.min(p[a + 1], p[b + 1]),
          Math.max(p[a], p[b]),
          Math.max(p[a + 1], p[b + 1]),
        ],
        e,
      );
    }
  }
  const corner = new Uint8Array(nx * nz);
  // Row by row: a corner is inside when the outline crosses its row an odd number of times to
  // its right (the even-odd rule of `insidePoly`).
  const xs: number[] = [];
  for (let j = 0; j < nz; j++) {
    const z = j * CELL;
    xs.length = 0;
    for (let k = 0; k < edges.length; k += 4) {
      const [xa, za, xb, zb] = [edges[k], edges[k + 1], edges[k + 2], edges[k + 3]];
      if (za > z !== zb > z) xs.push(xa + ((z - za) / (zb - za)) * (xb - xa));
    }
    xs.sort((p, q) => p - q);
    let left = 0;
    for (let i = 0; i < nx; i++) {
      while (left < xs.length && xs[left] <= i * CELL) left++;
      corner[j * nx + i] = (xs.length - left) & 1;
    }
  }
  return { bins: binBoxes(boxes, nx, nz), edges, corner };
}

/** Whether (x, z) is inside `r`; off the grid is outside. */
export function inRegion(r: Region, x: number, z: number): boolean {
  const cell = cellAt(r.bins, x, z);
  if (cell < 0) return false;
  const x0 = (cell % r.bins.nx) * CELL;
  const z0 = Math.floor(cell / r.bins.nx) * CELL;
  const { start, items } = r.bins;
  const ed = r.edges;
  let odd = r.corner[cell];
  for (let k = start[cell]; k < start[cell + 1]; k++) {
    const e = items[k] * 4;
    const xa = ed[e];
    const za = ed[e + 1];
    const xb = ed[e + 2];
    const zb = ed[e + 3];
    // Up the left side, from (x0, z0) to (x0, z).
    if (xa > x0 !== xb > x0) {
      const t = za + ((x0 - xa) / (xb - xa)) * (zb - za);
      if (t > z0 && t <= z) odd ^= 1;
    }
    // Along the row, from (x0, z) to (x, z).
    if (za > z !== zb > z) {
      const t = xa + ((z - za) / (zb - za)) * (xb - xa);
      if (t > x0 && t <= x) odd ^= 1;
    }
  }
  return odd === 1;
}

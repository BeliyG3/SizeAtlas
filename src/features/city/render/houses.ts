/** Every house of the island as one mesh of prisms, with light edges as one set of lines. */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { DISTRICT_TINT, LOOK } from "../look";
import type { World } from "../world/buildings";
import { disposeAll } from "./dispose";
import { triangulate } from "./flat";

/** The footprint is drawn this much inside its lot, metres, so neighbours part. */
const INSET = 0.4;
/** Edges of a dimmed house are their lit colour this much darker. */
const DIM_EDGE = 0.1;
/** How far a district's lit edges lean from `LOOK.wire` toward its tint: between these shares. */
const TINT_MIN = 0.08;
const TINT_MAX = 0.15;

export interface Houses {
  mesh: Mesh;
  /** For each triangle of `mesh`, the index of its house in `world.buildings`. */
  houseOfFace: Int32Array;
  /** Recolours the edges for the focus of `world` (the same buildings, in the same order). */
  paint(world: World): void;
  dispose(): void;
}

export function houseMesh(world: World): Houses {
  const positions: number[] = [];
  const faces: number[] = [];
  const edges: number[] = [];
  // Where each house's edges start in `edges`, in vertices; one more at the end.
  const edgeStart = new Int32Array(world.buildings.length + 1);
  world.buildings.forEach((b, house) => {
    const p = inset(b.points, INSET);
    const n = p.length / 2;
    const roof = triangulate(p);
    for (let k = 0; k < roof.length; k++) positions.push(p[roof[k] * 2], b.h, p[roof[k] * 2 + 1]);
    for (let k = 0; k < roof.length / 3; k++) faces.push(house);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x0, z0, x1, z1] = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
      // Two triangles wound to face out of the house (its inside is on the left of the way round).
      positions.push(x0, 0, z0, x1, b.h, z1, x1, 0, z1);
      positions.push(x0, 0, z0, x0, b.h, z0, x1, b.h, z1);
      faces.push(house, house);
      edges.push(x0, b.h, z0, x1, b.h, z1, x0, 0, z0, x0, b.h, z0);
    }
    edgeStart[house + 1] = edges.length / 3;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); // not indexed: one flat normal per face
  const mesh = new Mesh(
    geometry,
    // Faces are pushed back a little, so the edges drawn on them win the depth test.
    new MeshStandardMaterial({
      color: LOOK.body,
      metalness: 0.3,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute("position", new Float32BufferAttribute(edges, 3));
  const colors = new Float32BufferAttribute(new Float32Array(edges.length), 3);
  lineGeometry.setAttribute("color", colors);
  mesh.add(new LineSegments(lineGeometry, new LineBasicMaterial({ vertexColors: true })));

  const tints = new Map<number, { lit: Color; dim: Color }>();
  const tintOf = (district: number) => {
    let t = tints.get(district);
    if (!t) {
      const lit = districtEdge(district);
      t = { lit, dim: lit.clone().multiplyScalar(DIM_EDGE) };
      tints.set(district, t);
    }
    return t;
  };
  function paint(w: World) {
    w.buildings.forEach((b, house) => {
      const t = tintOf(b.district);
      const c = b.dim ? t.dim : t.lit;
      for (let v = edgeStart[house]; v < edgeStart[house + 1]; v++) colors.setXYZ(v, c.r, c.g, c.b);
    });
    colors.needsUpdate = true;
  }
  paint(world);
  return { mesh, houseOfFace: Int32Array.from(faces), paint, dispose: () => disposeAll(mesh) };
}

/** The lit edge colour of a district's houses: `LOOK.wire` leaning a little to a hue of its own. */
export function districtEdge(district: number): Color {
  let h = Math.imul(district ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  const share = TINT_MIN + ((TINT_MAX - TINT_MIN) * (h >>> 8)) / 0xffffff;
  return new Color(LOOK.wire).lerp(new Color(DISTRICT_TINT[h % DISTRICT_TINT.length]), share);
}

/**
 * `points` with every side moved `by` metres inward (the inside is on the left of the way round),
 * corners mitred. A lot too small to take it is kept as it is.
 */
export function inset(points: Float32Array, by: number): Float32Array {
  const n = points.length / 2;
  const out = new Float32Array(points.length);
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n;
    const j = (i + 1) % n;
    const [ax, az] = inward(points, h, i);
    const [bx, bz] = inward(points, i, j);
    const k = by / (1 + ax * bx + az * bz); // the mitre: both sides end up `by` away
    out[i * 2] = points[i * 2] + (ax + bx) * k;
    out[i * 2 + 1] = points[i * 2 + 1] + (az + bz) * k;
  }
  return area(out) > 0 && area(out) > area(points) * 0.25 ? out : points;
}

/** The unit normal of the side from point `a` to point `b`, pointing to its left (inside). */
function inward(p: Float32Array, a: number, b: number): [number, number] {
  const dx = p[b * 2] - p[a * 2];
  const dz = p[b * 2 + 1] - p[a * 2 + 1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

function area(p: Float32Array): number {
  let s = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    s += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return s / 2;
}

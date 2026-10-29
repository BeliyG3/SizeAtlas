import { Mesh } from "three";
import { describe, expect, it } from "vitest";
import { POLY, type Poly, type PolyKind } from "../world/map";
import { mapOf, square } from "../world/map.fixture";
import { groundMesh } from "./ground";

const poly = (kind: PolyKind, coords: number[]): Poly => ({
  island: 0,
  kind,
  id: 1,
  parent: 1,
  size: 0,
  points: new Float32Array(coords),
});

// An octagon-ish shore, a land with a notch, a square, a vacant lot and a 45° canal.
const island = poly(POLY.island, [20, 0, 80, 0, 100, 20, 100, 80, 80, 100, 20, 100, 0, 80, 0, 20]);
const land = poly(POLY.land, [10, 10, 90, 10, 90, 90, 50, 90, 50, 60, 10, 60]);
const canal = poly(POLY.water, [0, 0, 10, 0, 100, 90, 100, 100, 90, 100, 0, 10]);
const map = mapOf([
  island,
  canal,
  land,
  square(POLY.district, 2, 1, 0, 10, 10, 40),
  square(POLY.square, 3, 2, 0, 20, 20, 5),
  square(POLY.vacant, 4, 2, 0, 30, 30, 8),
]);

function shoelace(p: Float32Array): number {
  let s = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    s += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return s / 2;
}

/** Area of a mesh's triangles projected on y = 0, and whether all of them face up. */
function trianglesOf(mesh: Mesh): { area: number; up: boolean } {
  const pos = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const at = (k: number) => (index ? index.getX(k) : k);
  const count = index ? index.count : pos.count;
  let area = 0;
  let up = true;
  for (let k = 0; k < count; k += 3) {
    const [a, b, c] = [at(k), at(k + 1), at(k + 2)];
    const ux = pos.getX(b) - pos.getX(a);
    const uz = pos.getZ(b) - pos.getZ(a);
    const vx = pos.getX(c) - pos.getX(a);
    const vz = pos.getZ(c) - pos.getZ(a);
    const ny = uz * vx - ux * vz; // y of (b - a) × (c - a)
    if (ny < 0) up = false;
    area += Math.abs(ny) / 2;
  }
  return { area, up };
}

const layer = (group: ReturnType<typeof groundMesh>["group"], name: string) => {
  const mesh = group.getObjectByName(name);
  if (!(mesh instanceof Mesh)) throw new Error(`no layer ${name}`);
  return mesh;
};

describe("groundMesh", () => {
  it("layers keep their order", () => {
    const { group } = groundMesh(map);
    const names = ["water", "island", "land", "open", "canal"];
    const layers = names.map((n) => layer(group, n));
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].renderOrder).toBeGreaterThan(layers[i - 1].renderOrder);
      expect(layers[i].position.y).toBeGreaterThan(layers[i - 1].position.y);
    }
  });

  it("every polygon gives triangles", () => {
    const { group } = groundMesh(map);
    const expected: [string, number][] = [
      ["island", shoelace(island.points)],
      ["land", shoelace(land.points)],
      ["open", 25 + 64],
      ["canal", shoelace(canal.points)],
    ];
    for (const [name, area] of expected) {
      const got = trianglesOf(layer(group, name));
      expect(got.up).toBe(true);
      expect(Math.abs(got.area - area) / area).toBeLessThan(0.01);
    }
    // The water lies under the whole island and well beyond it.
    expect(trianglesOf(layer(group, "water")).area).toBeGreaterThan(100 * 100 * 10);
  });
});

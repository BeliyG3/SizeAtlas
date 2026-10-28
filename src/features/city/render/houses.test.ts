import { BufferGeometry, Color, LineSegments } from "three";
import { describe, expect, it } from "vitest";
import { LOOK } from "../look";
import { buildWorld } from "../world/buildings";
import { POLY, type Poly } from "../world/map";
import { mapOf, square } from "../world/map.fixture";
import { houseMesh } from "./houses";

const district = square(POLY.district, 1, 0, 300, 0, 0, 100);
const block = square(POLY.block, 2, 1, 300, 0, 0, 100);
// An L-shaped house with a 45° corner cut off: (0,0) (20,0) (20,10) (15,15) (10,15) (10,20) (0,20).
const diagonal: Poly = {
  kind: POLY.house,
  id: 10,
  parent: 2,
  size: 200,
  points: new Float32Array([0, 0, 20, 0, 20, 10, 15, 15, 10, 15, 10, 20, 0, 20]),
};
const plain = square(POLY.house, 11, 2, 100, 40, 40, 10);
const map = mapOf([district, block, diagonal, plain]);

function lines(mesh: ReturnType<typeof houseMesh>["mesh"]): LineSegments {
  const found = mesh.children.find((c) => c instanceof LineSegments);
  if (!found) throw new Error("no edges");
  return found as LineSegments;
}

describe("houseMesh", () => {
  it("one face map entry per triangle and every house present", () => {
    const world = buildWorld(map, null);
    const houses = houseMesh(world);
    const triangles = houses.mesh.geometry.getAttribute("position").count / 3;
    expect(houses.houseOfFace.length).toBe(triangles);
    expect(new Set(houses.houseOfFace)).toEqual(new Set([0, 1]));
    // The L has 7 sides: 5 roof triangles and 14 wall triangles; the square 2 and 8.
    expect(houses.houseOfFace.filter((h) => h === 0).length).toBe(5 + 14);
    expect(houses.houseOfFace.filter((h) => h === 1).length).toBe(2 + 8);
  });

  it("dimmed houses get darker edges after paint", () => {
    const houses = houseMesh(buildWorld(map, null));
    const colors = lines(houses.mesh).geometry.getAttribute("color");
    const before = colors.getX(0);
    expect(before).toBeCloseTo(new Color(LOOK.wire).r, 5);
    // Focus on the square: the L dims; its edges come first.
    houses.paint(buildWorld(map, 11));
    expect(colors.getX(0)).toBeLessThan(before * 0.5);
    expect(colors.getX(colors.count - 1)).toBeCloseTo(before, 5);
  });

  it("a 45° house keeps its diagonal walls", () => {
    const houses = houseMesh(buildWorld(map, null));
    const normal = houses.mesh.geometry.getAttribute("normal");
    let diagonals = 0;
    for (let i = 0; i < normal.count; i++) {
      const x = normal.getX(i);
      const z = normal.getZ(i);
      if (
        Math.abs(Math.abs(x) - Math.SQRT1_2) < 1e-3 &&
        Math.abs(Math.abs(z) - Math.SQRT1_2) < 1e-3
      ) {
        // The cut corner faces away from the house: toward +x, +z.
        expect(x).toBeGreaterThan(0);
        expect(z).toBeGreaterThan(0);
        diagonals++;
      }
    }
    expect(diagonals).toBe(6); // one wall: two triangles
    // Roofs face up, every other wall lies flat in y.
    for (let i = 0; i < normal.count; i++) {
      expect(Math.abs(normal.getY(i)) < 1e-6 || normal.getY(i) > 0.999).toBe(true);
    }
  });

  it("dispose frees every geometry", () => {
    const houses = houseMesh(buildWorld(map, null));
    const geometries = new Set<BufferGeometry>();
    houses.mesh.traverse((o) => {
      if ("geometry" in o) geometries.add(o.geometry as BufferGeometry);
    });
    expect(geometries.size).toBe(2);
    const freed = new Set<BufferGeometry>();
    for (const g of geometries) g.addEventListener("dispose", () => freed.add(g));
    houses.dispose();
    expect(freed).toEqual(geometries);
  });
});

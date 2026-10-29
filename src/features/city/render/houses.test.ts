import {
  BufferGeometry,
  Color,
  type LineBasicMaterial,
  LineSegments,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { describe, expect, it } from "vitest";
import { EDGE_FADE, LOOK } from "../look";
import { buildWorld } from "../world/buildings";
import { POLY, type Poly } from "../world/map";
import { mapOf, square } from "../world/map.fixture";
import { houseMesh, inset } from "./houses";

const district = square(POLY.district, 1, 0, 300, 0, 0, 100);
const block = square(POLY.block, 2, 1, 300, 0, 0, 100);
// An L-shaped house with a 45° corner cut off: (0,0) (20,0) (20,10) (15,15) (10,15) (10,20) (0,20).
const diagonal: Poly = {
  island: 0,
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
    // Both houses are in one district: one lit colour.
    expect(colors.getX(colors.count - 1)).toBe(before);
    // Focus on the square: the L dims; its edges come first.
    houses.paint(buildWorld(map, { island: 0, id: 11 }));
    expect(colors.getX(0)).toBeLessThan(before * 0.5);
    expect(colors.getX(colors.count - 1)).toBe(before);
  });

  it("each district tints its lit edges a little", () => {
    // The L in district 1, a square in district 3 and one more in district 1.
    const other = square(POLY.house, 12, 4, 100, 140, 40, 10);
    const same = square(POLY.house, 13, 2, 100, 70, 40, 10);
    const tinted = mapOf([
      district,
      block,
      square(POLY.district, 3, 0, 100, 100, 0, 100),
      square(POLY.block, 4, 3, 100, 100, 0, 100),
      diagonal,
      other,
      same,
    ]);
    const world = buildWorld(tinted, null);
    const houses = houseMesh(world);
    const colors = lines(houses.mesh).geometry.getAttribute("color");
    // The first edge vertex of each house: two segments (4 vertices) per corner, the L has 7.
    const first = (house: number) => {
      const v = [0, 28, 28 + 16][house];
      return new Color(colors.getX(v), colors.getY(v), colors.getZ(v));
    };
    const wire = new Color(LOOK.wire);
    for (const house of [0, 1, 2]) {
      const c = first(house);
      expect(Math.abs(c.r - wire.r)).toBeLessThan(0.2);
      expect(Math.abs(c.g - wire.g)).toBeLessThan(0.2);
      expect(Math.abs(c.b - wire.b)).toBeLessThan(0.2);
    }
    expect(world.buildings.map((b) => b.district)).toEqual([1, 3, 1]);
    expect(first(1).equals(first(0))).toBe(false);
    expect(first(2).equals(first(0))).toBe(true);
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

  it("edges fade with distance through the shader of their own material", () => {
    const material = lines(houseMesh(buildWorld(map, null)).mesh).material as LineBasicMaterial;
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    } as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, null as never);
    expect(shader.vertexShader).toContain("vEdgeDistance = length( mvPosition.xyz );");
    expect(shader.fragmentShader).toContain("varying float vEdgeDistance;");
    expect(shader.fragmentShader).toContain(`( vEdgeDistance - ${EDGE_FADE.near}.0 )`);
    expect(shader.fragmentShader).toContain(`/ ${EDGE_FADE.far - EDGE_FADE.near}.0`);
    expect(shader.fragmentShader).toContain(`( 1.0 - ${EDGE_FADE.floor} )`);
    // The fade is applied before the colour leaves the shader.
    const fade = shader.fragmentShader.indexOf("outgoingLight *=");
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(shader.fragmentShader.indexOf("#include <opaque_fragment>"));
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

describe("inset", () => {
  // A filler lot of a real archipelago (float32): vertex 0 is the tip of a spur that doubles back, where
  // the mitre divides by almost 0; nudged by one float32 step it flew some 6 km out.
  const spur = [
    3468.32177734375, 1013.178284, 3484.82177734375, 1029.677856, 3484.821533203125,
    1034.1785888671875, 3483.32177734375, 1034.1783447265625, 3469.822021484375, 1047.678345,
    3469.821533203125, 1014.678284,
  ];

  it("never moves a corner far, whatever the rounding at a spur", () => {
    const by = 0.5;
    for (let ulp = -4; ulp <= 4; ulp++) {
      const points = Float32Array.from(spur);
      const view = new Uint32Array(points.buffer);
      view[0] += ulp; // the tip, one float32 step at a time
      const out = inset(points, by);
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        expect(Math.abs(out[i] - points[i])).toBeLessThanOrEqual(by * 4 + 1e-3);
      }
    }
  });
});

import { InstancedMesh, ShaderLib, type DataTexture, type IUniform } from "three";
import { describe, expect, it } from "vitest";
import { CROWD_CARS, CROWD_PEOPLE, CROWD_ROUTES, crowdOn } from "../panel/life";
import { ROAD } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { ROUTE_POINTS, ROUTE_STEP, type Routes } from "../world/routes";
import { CROWD_FADE, crowdAt, crowdMesh, crowdShow, type Crowd } from "./crowd";

/** One route east along z = 0 from x = 0 to 200 m, 1 m up, 3 m to the side, and back: 400 m. */
function line(): Routes {
  const steps = 200 / ROUTE_STEP;
  const points = new Float32Array(ROUTE_POINTS * 4);
  for (let k = 0; k <= 2 * steps; k++) {
    const x = (k <= steps ? k : 2 * steps - k) * ROUTE_STEP;
    points.set([x, 1, 0, 3], k * 4);
  }
  return { count: 1, points, length: new Float32Array([400]) };
}

/** The crowd's material run on `vertexShader`, as the renderer would before compiling it. */
function compile(crowd: Crowd, vertexShader: string) {
  const shader = { vertexShader, uniforms: {} as Record<string, IUniform> };
  (crowd.mesh.material as unknown as { onBeforeCompile(s: typeof shader): void }).onBeforeCompile(
    shader,
  );
  return shader;
}

const town = buildRoads(
  mapOf([], {
    nodes: new Float32Array([0, 0, 1000, 0, 1000, 600]),
    edges: [
      { a: 0, b: 1, cls: ROAD.street, bridge: false, liftA: 0, liftB: 0 },
      { a: 1, b: 2, cls: ROAD.highway, bridge: false, liftA: 0, liftB: 0 },
    ],
  }),
);

describe("crowdAt", () => {
  const r = line();

  it("moves a particle along its route at its speed", () => {
    const a = crowdAt(r, 0, 10, 5, 0, 2);
    const b = crowdAt(r, 0, 10, 5, 0, 3);
    expect([a.x, a.y, a.z]).toEqual([20, 1, 0]);
    expect(b.x - a.x).toBeCloseTo(5);
    expect([a.dx, a.dz]).toEqual([1, 0]);
  });

  it("keeps the route's offset right of the way (side 1) or left (-1), there and back", () => {
    // Going east the right is +z; coming back west, -z.
    expect(crowdAt(r, 0, 50, 1, 1, 0)).toMatchObject({ x: 50, z: 3 });
    expect(crowdAt(r, 0, 50, 1, -1, 0)).toMatchObject({ x: 50, z: -3 });
    const back = crowdAt(r, 0, 350, 1, 1, 0);
    expect(back.x).toBeCloseTo(50);
    expect(back.z).toBe(-3);
    expect(back.dx).toBe(-1);
  });

  it("comes back to where it was after the route's length", () => {
    const a = crowdAt(r, 0, 37, 1.3, -1, 11);
    const b = crowdAt(r, 0, 37, 1.3, -1, 11 + 400 / 1.3);
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.z).toBeCloseTo(a.z, 3);
  });
});

describe("crowdShow", () => {
  it("hides a particle inside the circle and grows it in by the fade's edge", () => {
    expect([0, 100, 199.9].map((d) => crowdShow(d, 200))).toEqual([0, 0, 0]);
    expect([CROWD_FADE * 200, 300, 5000].map((d) => crowdShow(d, 200))).toEqual([1, 1, 1]);
    const mid = crowdShow(215, 200);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("crowdMesh", () => {
  it("is one mesh a kind with every particle", () => {
    const crowd = crowdOn(town, 3);
    expect(crowd.map((c) => c.mesh instanceof InstancedMesh)).toEqual([true, true]);
    expect(crowd.map((c) => c.mesh.count)).toEqual([CROWD_CARS, CROWD_PEOPLE]);
    const routes = crowd[0].mesh.geometry.getAttribute("crowdRoute").array;
    expect(Math.max(...routes)).toBe(CROWD_ROUTES - 1);
    for (const c of crowd) c.dispose();
  });

  it("has nobody on a map without its roads", () => {
    const empty = crowdMesh(
      { count: 0, points: new Float32Array(0), length: new Float32Array(0) },
      "walk",
      50,
      1,
    );
    expect(empty.mesh.count).toBe(0);
    empty.dispose();
  });

  it("moves its time on and frees its texture", () => {
    const crowd = crowdMesh(line(), "drive", 10, 1);
    const u = compile(crowd, ShaderLib.standard.vertexShader).uniforms;
    crowd.update(0.5, { x: 3, z: 4, r: 150 });
    crowd.update(0.25, { x: 3, z: 4, r: 150 });
    expect(u.uTime.value).toBe(0.75);
    expect(u.uRadius.value).toBe(150);
    expect(u.uCenter.value.toArray()).toEqual([3, 4]);
    const texture = u.uRoutes.value as DataTexture;
    expect([texture.image.width, texture.image.height]).toEqual([ROUTE_POINTS, 1]);
    let freed = false;
    texture.addEventListener("dispose", () => (freed = true));
    crowd.dispose();
    expect(freed).toBe(true);
  });

  it("places the vertices in the shaders of both kinds", () => {
    for (const [kind, lib] of [
      ["drive", ShaderLib.standard],
      ["walk", ShaderLib.basic],
    ] as const) {
      const crowd = crowdMesh(line(), kind, 1, 1);
      const shader = compile(crowd, lib.vertexShader);
      expect(shader.vertexShader).toContain("crowdPlace();");
      expect(shader.vertexShader).toContain("transformed = crowdPos + crowdTurn");
      if (kind === "drive") expect(shader.vertexShader).toContain("objectNormal = crowdTurn");
      crowd.dispose();
    }
  });
});

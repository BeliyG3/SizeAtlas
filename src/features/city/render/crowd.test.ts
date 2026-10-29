import { InstancedMesh, Points, ShaderLib, type DataTexture, type IUniform } from "three";
import { describe, expect, it } from "vitest";
import { CROWD_CARS, CROWD_PEOPLE, CROWD_ROUTES, crowdOn } from "../panel/life";
import { ROAD } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { ROUTE_POINTS } from "../world/routes";
import { CROWD_NEAR, crowdMesh, type Crowd } from "./crowd";
import { line } from "./crowd.fixture";

/** The crowd's body material run on `vertexShader`, as the renderer would before compiling it. */
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

describe("crowdMesh", () => {
  it("is one mesh of bodies and one set of lights a kind, with every particle", () => {
    const crowd = crowdOn(town, 3);
    expect(crowd.map((c) => c.mesh instanceof InstancedMesh)).toEqual([true, true]);
    expect(crowd.map((c) => c.lights instanceof Points)).toEqual([true, true]);
    expect(crowd.map((c) => c.group.children.length)).toEqual([2, 2]);
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
    expect(empty.lights.geometry.getAttribute("position").count).toBe(0);
    empty.dispose();
  });

  it("moves bodies and lights on one clock and frees everything", () => {
    const crowd = crowdMesh(line(), "drive", 10, 1);
    const u = compile(crowd, ShaderLib.standard.vertexShader).uniforms;
    const lit = (crowd.lights.material as unknown as { uniforms: Record<string, IUniform> })
      .uniforms;
    crowd.update(0.5, { x: 1, z: 2, r: 150 });
    for (const v of [u, lit]) expect(v.uRadius.value).toBe(150);
    // A zoomed-out circle: the crowd still shows past `CROWD_NEAR`.
    crowd.update(0.25, { x: 3, z: 4, r: 2000 });
    for (const v of [u, lit]) {
      expect(v.uTime.value).toBe(0.75);
      expect(v.uRadius.value).toBe(CROWD_NEAR);
      expect(v.uCenter.value.toArray()).toEqual([3, 4]);
    }
    const texture = u.uRoutes.value as DataTexture;
    expect(lit.uRoutes.value).toBe(texture);
    expect([texture.image.width, texture.image.height]).toEqual([ROUTE_POINTS, 1]);
    const freed = new Set<string>();
    const watch = (name: string, o: { addEventListener(t: "dispose", f: () => void): void }) =>
      o.addEventListener("dispose", () => freed.add(name));
    watch("texture", texture);
    watch("lights", crowd.lights.geometry);
    watch("light material", crowd.lights.material as never);
    watch("bodies", crowd.mesh.geometry);
    crowd.dispose();
    expect([...freed].sort()).toEqual(["bodies", "light material", "lights", "texture"]);
  });

  it("places the vertices in the shaders of both kinds", () => {
    for (const [kind, lib] of [
      ["drive", ShaderLib.standard],
      ["walk", ShaderLib.basic],
    ] as const) {
      const crowd = crowdMesh(line(), kind, 1, 1);
      const shader = compile(crowd, lib.vertexShader);
      expect(shader.vertexShader).toContain("crowdPlace( 0.0 );");
      expect(shader.vertexShader).toContain("transformed = crowdPos + crowdTurn");
      if (kind === "drive") expect(shader.vertexShader).toContain("objectNormal = crowdTurn");
      crowd.dispose();
    }
  });
});

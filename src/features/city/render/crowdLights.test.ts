import { AdditiveBlending, Color, ShaderMaterial, Vector2, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { LOOK, ROLE_COLOR } from "../look";
import { CAR_LENGTH } from "./cars";
import { crowdMesh } from "./crowd";
import { line } from "./crowd.fixture";
import { CROWD_PLACE } from "./crowdPlace";
import { LIGHT_MAX_PX, LIGHT_MIN_PX } from "./crowdLights";

const rgb = (c: string) => new Color(c).toArray();

describe("crowdLights", () => {
  it("gives a car a tail light behind and a head light ahead", () => {
    const crowd = crowdMesh(line(), "drive", 3, 1);
    const g = crowd.lights.geometry;
    expect(g.getAttribute("position").count).toBe(6);
    expect(Array.from(g.getAttribute("crowdAlong").array)).toEqual(
      [0, 1, 2].flatMap(() => [-CAR_LENGTH / 2, CAR_LENGTH / 2].map(Math.fround)),
    );
    const color = g.getAttribute("lightColor");
    for (let car = 0; car < 3; car++) {
      expect([color.getX(car * 2), color.getY(car * 2), color.getZ(car * 2)]).toEqual(
        rgb(LOOK.virus).map(Math.fround),
      );
      expect([color.getX(car * 2 + 1), color.getY(car * 2 + 1), color.getZ(car * 2 + 1)]).toEqual(
        rgb(LOOK.wire).map(Math.fround),
      );
    }
    // Both lights of a car move as the car: the same particle data.
    const s0 = g.getAttribute("crowdS0");
    expect(s0.getX(4)).toBe(s0.getX(5));
    expect(s0.getX(4)).toBe(crowd.mesh.geometry.getAttribute("crowdS0").getX(2));
    crowd.dispose();
  });

  it("gives a walker one dim dot of the resident's colour", () => {
    const crowd = crowdMesh(line(), "walk", 4, 1);
    const g = crowd.lights.geometry;
    expect(g.getAttribute("position").count).toBe(4);
    const color = g.getAttribute("lightColor");
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual(
      rgb(ROLE_COLOR[0]).map(Math.fround),
    );
    const u = (crowd.lights.material as ShaderMaterial).uniforms;
    expect([u.uMinPx.value, u.uBright.value]).toEqual([1.5, 0.5]);
    crowd.dispose();
  });

  it("is soft additive points placed by the shared GLSL, sized for the canvas", () => {
    const crowd = crowdMesh(line(), "drive", 1, 1);
    const m = crowd.lights.material as ShaderMaterial;
    expect([m.transparent, m.depthWrite, m.blending]).toEqual([true, false, AdditiveBlending]);
    expect(m.vertexShader).toContain(CROWD_PLACE);
    expect(m.vertexShader).toContain("crowdPlace( crowdAlong );");
    expect(m.vertexShader).toContain(`float( ${LIGHT_MAX_PX} ) * uRatio`);
    expect(m.uniforms.uMinPx.value).toBe(LIGHT_MIN_PX);
    expect(m.fragmentShader).toContain("gl_PointCoord");
    const renderer = {
      getDrawingBufferSize: (v: Vector2) => v.set(1600, 900),
      getPixelRatio: () => 2,
    } as unknown as WebGLRenderer;
    crowd.lights.onBeforeRender(renderer, null!, null!, null!, null!, null!);
    expect([m.uniforms.uHalfHeight.value, m.uniforms.uRatio.value]).toEqual([450, 2]);
    crowd.dispose();
  });
});

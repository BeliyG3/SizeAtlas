import { AdditiveBlending, Color, ShaderMaterial, Vector3, type Points } from "three";
import { describe, expect, it } from "vitest";
import type { Traffic } from "../actors/traffic";
import { LOOK } from "../look";
import { carLights } from "./carLights";
import { LIGHT_FRAGMENT, LIGHT_VERTEX } from "./lights";

const tail = new Vector3(0.1, 0.6, -2);

/** `n` cars at x = 0, 10, 20..., heading +z, all live and grown. */
const traffic = (n: number): Traffic => ({
  count: n,
  x: Float32Array.from({ length: n }, (_, i) => i * 10),
  y: new Float32Array(n),
  z: new Float32Array(n),
  heading: new Float32Array(n),
  air: new Uint8Array(n),
  appear: new Float32Array(n).fill(1),
  live: new Uint8Array(n).fill(1),
  update: () => {},
});

const at = (points: Points, v: number) => {
  const p = points.geometry.getAttribute("position");
  return [p.getX(v), p.getY(v), p.getZ(v)];
};
const rgb = (points: Points, v: number) => {
  const c = points.geometry.getAttribute("lightColor");
  return [c.getX(v), c.getY(v), c.getZ(v)];
};

describe("carLights", () => {
  it("draws a tail light and a head light for each car, in one set of points", () => {
    const lights = carLights(10, tail);
    lights.update(traffic(3));
    expect(lights.points.geometry.drawRange.count).toBe(6);
    expect(rgb(lights.points, 0)).toEqual(new Color(LOOK.virus).toArray().map(Math.fround));
    expect(rgb(lights.points, 1)).toEqual(new Color(LOOK.wire).toArray().map(Math.fround));
    expect(rgb(lights.points, 5)).toEqual(rgb(lights.points, 1));
    lights.dispose();
  });

  it("puts the tail behind and the head ahead along the heading", () => {
    const lights = carLights(10, tail);
    const t = traffic(2);
    lights.update(t);
    expect(at(lights.points, 0)[2]).toBeCloseTo(-2);
    expect(at(lights.points, 1)[2]).toBeCloseTo(2);
    expect(at(lights.points, 1)[1]).toBeCloseTo(0.6);
    // Turned to +x the car's back is at -x.
    t.heading[1] = Math.PI / 2;
    lights.update(t);
    expect(at(lights.points, 2)[0]).toBeCloseTo(10 - 2);
    expect(at(lights.points, 3)[0]).toBeCloseTo(10 + 2);
    expect(at(lights.points, 2)[2]).toBeCloseTo(-0.1);
    lights.dispose();
  });

  it("leaves out a car off the roads and dims one growing in", () => {
    const lights = carLights(10, tail);
    const t = traffic(3);
    t.live[0] = 0;
    t.appear[2] = 0.5;
    lights.update(t);
    expect(lights.points.geometry.drawRange.count).toBe(4);
    // Car 1 is now in the first slot, car 2 in the second.
    expect(at(lights.points, 0)[0]).toBeCloseTo(10 + 0.1);
    expect(rgb(lights.points, 0)[0]).toBeCloseTo(new Color(LOOK.virus).r);
    expect(rgb(lights.points, 2)[0]).toBeCloseTo(new Color(LOOK.virus).r * 0.5);
    expect(rgb(lights.points, 3)[2]).toBeCloseTo(new Color(LOOK.wire).b * 0.5);
    lights.dispose();
  });

  it("shares the soft additive point of the crowd lights and frees its buffers", () => {
    const lights = carLights(4, tail);
    const m = lights.points.material as ShaderMaterial;
    expect(m.blending).toBe(AdditiveBlending);
    expect(m.vertexShader).toContain(LIGHT_VERTEX);
    expect(m.fragmentShader).toBe(LIGHT_FRAGMENT);
    let freed = 0;
    lights.points.geometry.addEventListener("dispose", () => freed++);
    m.addEventListener("dispose", () => freed++);
    lights.dispose();
    expect(freed).toBe(2);
  });
});

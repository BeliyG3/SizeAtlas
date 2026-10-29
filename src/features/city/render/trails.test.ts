import { Color, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { Traffic } from "../actors/traffic";
import { LOOK } from "../look";
import { TRAIL_GLOW, TRAIL_POINTS, TRAIL_SECONDS, trailMesh } from "./trails";

const POINTS = TRAIL_POINTS + 1;
const tail = new Vector3(0, 0.6, -2);

/** Cars at `xs` along z = 0, heading +z. */
const traffic = (xs: number[]): Traffic => ({
  count: xs.length,
  x: Float32Array.from(xs),
  y: new Float32Array(xs.length),
  z: new Float32Array(xs.length),
  heading: new Float32Array(xs.length),
  air: new Uint8Array(xs.length),
  appear: new Float32Array(xs.length).fill(1),
  live: new Uint8Array(xs.length).fill(1),
  update: () => {},
});

/** The middle line of the ribbon in `slot`: a point per pair of vertices. */
function line(trails: ReturnType<typeof trailMesh>, slot: number): Vector3[] {
  const p = trails.mesh.geometry.getAttribute("position");
  return Array.from({ length: POINTS }, (_, k) => {
    const v = (slot * POINTS + k) * 2;
    return new Vector3(
      (p.getX(v) + p.getX(v + 1)) / 2,
      (p.getY(v) + p.getY(v + 1)) / 2,
      (p.getZ(v) + p.getZ(v + 1)) / 2,
    );
  });
}

const length = (points: Vector3[]) =>
  points.slice(1).reduce((sum, p, k) => sum + p.distanceTo(points[k]), 0);

/** Drives car 0 of `t` along +z at `speed` for `seconds`, the camera above it. */
function drive(trails: ReturnType<typeof trailMesh>, t: Traffic, speed: number, seconds: number) {
  for (let n = 0; n < seconds * 30; n++) {
    t.z[0] += speed / 30;
    trails.update(t, new Vector3(t.x[0], 20, t.z[0]), 1 / 30);
  }
}

describe("trailMesh", () => {
  it("is one mesh drawing every trail, each in its slot of one geometry", () => {
    const trails = trailMesh(10, tail);
    const t = traffic([0, 10, 20]);
    for (let n = 0; n < 30; n++) {
      for (let i = 0; i < 3; i++) t.z[i] += 0.5;
      trails.update(t, new Vector3(10, 20, t.z[0]), 1 / 30);
    }
    expect(trails.mesh).toBeInstanceOf(Mesh);
    expect(trails.mesh.geometry.drawRange.count).toBe(3 * TRAIL_POINTS * 6);
    // Every car's ribbon starts at its own light.
    for (let slot = 0; slot < 3; slot++) expect(line(trails, slot)[0].x).toBeCloseTo(slot * 10, 4);
    trails.dispose();
  });

  it("runs back from the tail light as far as the car went in its seconds", () => {
    for (const speed of [12, 22, 30]) {
      const trails = trailMesh(4, tail);
      const t = traffic([0]);
      drive(trails, t, speed, 1);
      const points = line(trails, 0);
      expect(points[0].distanceTo(new Vector3(0, 0.6, t.z[0] - 2))).toBeLessThan(1e-4);
      const want = speed * TRAIL_SECONDS;
      expect(Math.abs(length(points) - want)).toBeLessThanOrEqual(0.15 * want);
      // Straight behind the car.
      for (const p of points) expect(p.z).toBeLessThanOrEqual(points[0].z + 1e-4);
      trails.dispose();
    }
  });

  it("shrinks to nothing while the car stands", () => {
    const trails = trailMesh(4, tail);
    const t = traffic([0]);
    drive(trails, t, 22, 1);
    drive(trails, t, 0, 1);
    expect(length(line(trails, 0))).toBeCloseTo(0, 4);
    trails.dispose();
  });

  it("starts afresh after a jump", () => {
    const trails = trailMesh(4, tail);
    const t = traffic([0]);
    drive(trails, t, 22, 1);
    t.z[0] += 50;
    trails.update(t, new Vector3(0, 20, t.z[0]), 1 / 30);
    expect(length(line(trails, 0))).toBeCloseTo(0, 4);
    trails.dispose();
  });

  it("fades from the light to its end", () => {
    const trails = trailMesh(4, tail);
    const t = traffic([0]);
    drive(trails, t, 22, 1);
    const c = trails.mesh.geometry.getAttribute("color");
    const glow = Array.from({ length: POINTS }, (_, k) => c.getX(k * 2));
    expect(glow[0]).toBeCloseTo(TRAIL_GLOW * new Color(LOOK.virus).r, 5);
    for (let k = 1; k < POINTS; k++) expect(glow[k]).toBeLessThanOrEqual(glow[k - 1]);
    expect(glow[POINTS - 1]).toBe(0);
    trails.dispose();
  });

  it("draws no trail for a car farther than the middle distance", () => {
    const trails = trailMesh(4, tail);
    const t = traffic([0, 0]);
    t.x[1] = 300;
    trails.update(t, new Vector3(0, 20, 0), 1 / 30);
    expect(trails.mesh.geometry.drawRange.count).toBe(TRAIL_POINTS * 6);
    trails.update(t, new Vector3(-300, 20, 0), 1 / 30);
    expect(trails.mesh.geometry.drawRange.count).toBe(0);
    trails.dispose();
  });
});

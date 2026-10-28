import { Box3, Matrix4, Vector3, type InstancedMesh } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import type { Residents } from "../actors/residents";
import type { Traffic } from "../actors/traffic";
import { carInstances, CAR_LENGTH } from "./cars";
import carUrl from "../assets/skycar.glb?inline";
import walkerUrl from "../assets/walker.glb?inline";
import { bakeWalk, peopleInstances, POSES } from "./people";

/** A model of the city's assets, read in node from the data URL the test build inlines. */
async function load(url: string): Promise<GLTF> {
  const data = await (await fetch(url)).arrayBuffer();
  return new GLTFLoader().parseAsync(data, "");
}

const residents = (xs: number[], phases: number[]): Residents => ({
  count: xs.length,
  x: Float32Array.from(xs),
  z: new Float32Array(xs.length),
  heading: new Float32Array(xs.length),
  phase: Float32Array.from(phases),
  role: new Uint8Array(xs.length),
  update: () => {},
});

describe("peopleInstances", () => {
  it("bakes distinct walk poses standing in place", async () => {
    const walker = await load(walkerUrl);
    const poses = bakeWalk(walker);
    expect(poses.length).toBe(POSES);
    const boxes = poses.map((g) =>
      new Box3().setFromBufferAttribute(g.getAttribute("position") as never),
    );
    for (const b of boxes) {
      expect(b.min.y).toBeGreaterThan(-0.1);
      expect(b.max.y).toBeGreaterThan(1.6);
      expect(b.max.y).toBeLessThan(2);
      // In place: the walk does not carry the figure off its spot.
      const c = b.getCenter(new Vector3());
      expect(Math.hypot(c.x, c.z)).toBeLessThan(0.5);
    }
    const a = poses[0].getAttribute("position").array;
    const b = poses[POSES / 2].getAttribute("position").array;
    expect(a.some((v, i) => Math.abs(v - b[i]) > 0.05)).toBe(true);
  });

  it("near figures take the pose of their phase, far ones the column", async () => {
    const people = peopleInstances(await load(walkerUrl), 10);
    people.update(residents([0, 5, 500, 10], [0, 0.99, 0.5, 0.13]), new Vector3(0, 300, 0));
    const meshes = people.group.children as InstancedMesh[];
    expect(meshes.length).toBe(POSES + 1);
    expect(meshes.map((m) => m.count)).toEqual([1, 1, 0, 0, 0, 0, 0, 1, 1]);
    const m = new Matrix4();
    meshes[POSES].getMatrixAt(0, m);
    expect(new Vector3().setFromMatrixPosition(m).x).toBe(500);
    people.dispose();
  });
});

describe("carInstances", () => {
  it("one instanced mesh per material, the car scaled to its length", async () => {
    const car = (await load(carUrl)).scene;
    const cars = carInstances(car, 60);
    const meshes = cars.group.children as InstancedMesh[];
    expect(meshes.length).toBe(8); // nine materials, the panel is drawn as the body
    const box = new Box3();
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!);
    }
    expect(box.max.z - box.min.z).toBeCloseTo(CAR_LENGTH, 3);
    const traffic: Traffic = {
      count: 2,
      x: Float32Array.from([10, 20]),
      y: Float32Array.from([0, 35]),
      z: Float32Array.from([0, 5]),
      heading: Float32Array.from([0, Math.PI / 2]),
      air: Uint8Array.from([0, 1]),
      update: () => {},
    };
    cars.update(traffic);
    expect(meshes.every((mesh) => mesh.count === 2)).toBe(true);
    const m = new Matrix4();
    meshes[0].getMatrixAt(1, m);
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([20, 35, 5]);
    // Heading π/2 points the model's nose (+z) along +x.
    const nose = new Vector3(0, 0, 1).transformDirection(m);
    expect(nose.x).toBeCloseTo(1, 5);
    cars.dispose();
  });
});

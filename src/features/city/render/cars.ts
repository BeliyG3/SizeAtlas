/**
 * The traffic as instanced cars: near the camera the model, its parts merged by material into one
 * instanced mesh each, all sharing one set of instance matrices; farther off a body with a cabin
 * of a few faces, and farthest a plain box, both of the body's material.
 */
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Traffic } from "../actors/traffic";
import { LOOK } from "../look";
import { disposeAll } from "./dispose";

/** A car is this long, metres; the model is scaled to it. */
export const CAR_LENGTH = 4.2;
/** Cars within this many metres of the camera are drawn as models... */
export const CAR_NEAR = 80;
/** ...then up to this many as a body with a cabin (`midCar`), the rest as boxes. */
export const CAR_MID = 250;
/** The far car: a box this wide and tall, `CAR_LENGTH` long, metres. */
export const CAR_BOX = [1.8, 1.3] as const;

const std = (color: string | number, metalness = 0.7, roughness = 0.3) =>
  new MeshStandardMaterial({ color, metalness, roughness, flatShading: true, side: DoubleSide });

/** The car's look by the model's material names; any other name is the body. */
function materials(): Record<string, Material> {
  return {
    Body: std(LOOK.body),
    Interior: std(0x10151c, 0.2, 0.6),
    Tyre: std(0x07090c, 0.1, 0.7),
    Seat: std(0x2a3038, 0.1, 0.8),
    Glass: new MeshStandardMaterial({
      color: 0x0b1c2c,
      metalness: 0.9,
      roughness: 0.08,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
    }),
    Glow: new MeshBasicMaterial({ color: LOOK.wire }),
    Tail: new MeshBasicMaterial({ color: LOOK.virus }),
    // The dash displays: the role colour, dimmed.
    Screen: new MeshBasicMaterial({ color: new Color(LOOK.wire).multiplyScalar(0.3) }),
  };
}

export function carInstances(
  car: Object3D,
  max: number,
): { group: Group; update(t: Traffic, camera: Vector3): void; dispose(): void } {
  const looks = materials();
  const parts = new Map<string, BufferGeometry[]>();
  car.updateMatrixWorld(true);
  const toCar = car.matrixWorld.clone().invert();
  // The model as it stands: doors shut, wheels straight.
  car.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const name = (o.material as Material).name in looks ? (o.material as Material).name : "Body";
    const part = new BufferGeometry();
    const source = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    part.setAttribute("position", source.getAttribute("position").clone());
    part.setAttribute("normal", source.getAttribute("normal").clone());
    part.applyMatrix4(new Matrix4().multiplyMatrices(toCar, o.matrixWorld));
    parts.set(name, [...(parts.get(name) ?? []), part]);
  });
  const geometries = [...parts].map(([name, list]) => {
    const merged = mergeGeometries(list);
    for (const g of list) g.dispose();
    return [name, merged] as const;
  });
  const box = new Box3();
  for (const [, g] of geometries) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  const scale = CAR_LENGTH / (box.max.z - box.min.z || CAR_LENGTH);

  const group = new Group();
  const matrices = new InstancedBufferAttribute(new Float32Array(max * 16), 16);
  const meshes = geometries.map(([name, g]) => {
    g.scale(scale, scale, scale);
    const mesh = new InstancedMesh(g, looks[name], max);
    mesh.instanceMatrix = matrices;
    mesh.count = 0;
    mesh.frustumCulled = false; // the cars move: a bounding sphere would go stale
    mesh.name = `car ${name}`;
    group.add(mesh);
    return mesh;
  });
  // Farther off one draw for every car of each band, in the body's own material.
  const lod = (geometry: BufferGeometry, name: string) => {
    const mesh = new InstancedMesh(geometry, looks.Body, max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const mid = lod(midCar(), "car mid");
  const far = lod(
    new BoxGeometry(CAR_BOX[0], CAR_BOX[1], CAR_LENGTH).translate(0, CAR_BOX[1] / 2, 0),
    "car far",
  );

  const matrix = new Matrix4();
  const at = new Vector3();
  const turn = new Quaternion();
  const size = new Vector3();
  const up = new Vector3(0, 1, 0);
  // A moved car grows in from nothing (`appear`).
  const put = (t: Traffic, i: number, array: Float32Array, slot: number) => {
    turn.setFromAxisAngle(up, t.heading[i]); // the model faces +z, as `heading` measures
    size.setScalar(t.appear[i]);
    matrix.compose(at.set(t.x[i], t.y[i], t.z[i]), turn, size).toArray(array, slot * 16);
  };
  const bands = [matrices, mid.instanceMatrix, far.instanceMatrix];
  const near2 = CAR_NEAR * CAR_NEAR;
  const mid2 = CAR_MID * CAR_MID;
  function update(t: Traffic, camera: Vector3) {
    const counts = [0, 0, 0];
    for (let i = 0; i < Math.min(t.count, max); i++) {
      const d2 = (t.x[i] - camera.x) ** 2 + (t.y[i] - camera.y) ** 2 + (t.z[i] - camera.z) ** 2;
      const band = d2 <= near2 ? 0 : d2 <= mid2 ? 1 : 2;
      put(t, i, bands[band].array as Float32Array, counts[band]++);
    }
    for (const b of bands) b.needsUpdate = true;
    for (const m of meshes) m.count = counts[0];
    mid.count = counts[1];
    far.count = counts[2];
  }
  return { group, update, dispose: () => disposeAll(group) };
}

/**
 * The car at a middle distance, 24 triangles: the body as a low box and on it a cabin narrowing
 * to its roof, `CAR_LENGTH` long, on the ground, nose to +z like the model.
 */
export function midCar(): BufferGeometry {
  const [w, h] = CAR_BOX;
  const body = new BoxGeometry(w, h * 0.55, CAR_LENGTH).translate(0, h * 0.275, 0);
  const cabin = new BoxGeometry(w * 0.9, h * 0.45, CAR_LENGTH * 0.5);
  const p = cabin.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.8, p.getY(i), p.getZ(i) * 0.6);
  }
  cabin.computeVertexNormals();
  cabin.translate(0, h * 0.775, -CAR_LENGTH * 0.05);
  const car = mergeGeometries([body, cabin])!;
  body.dispose();
  cabin.dispose();
  return car;
}

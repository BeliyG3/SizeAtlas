/**
 * The traffic as instanced cars: near the camera the model, its parts merged by material into one
 * instanced mesh each, all sharing one set of instance matrices; farther off a plain lit box.
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
import { splitNear } from "../actors/residents";
import type { Traffic } from "../actors/traffic";
import { LOOK } from "../look";
import { disposeAll } from "./dispose";

/** A car is this long, metres; the model is scaled to it. */
export const CAR_LENGTH = 4.2;
/** Cars within this many metres of the camera are drawn as models, the rest as boxes. */
export const CAR_NEAR = 200;
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
  // From afar a box in the glow of the wires, dimmed: one draw for every far car.
  const brick = new BoxGeometry(CAR_BOX[0], CAR_BOX[1], CAR_LENGTH).translate(0, CAR_BOX[1] / 2, 0);
  const glow = new MeshBasicMaterial({ color: new Color(LOOK.wire).multiplyScalar(0.35) });
  const far = new InstancedMesh(brick, glow, max);
  far.count = 0;
  far.frustumCulled = false;
  far.name = "car far";
  group.add(far);

  const split = { near: new Int32Array(max), far: new Int32Array(max) };
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
  function update(t: Traffic, camera: Vector3) {
    const got = splitNear(t, Math.min(t.count, max), camera, CAR_NEAR, split);
    const farMatrices = far.instanceMatrix;
    for (let k = 0; k < got.near; k++) put(t, split.near[k], matrices.array as Float32Array, k);
    for (let k = 0; k < got.far; k++) put(t, split.far[k], farMatrices.array as Float32Array, k);
    matrices.needsUpdate = farMatrices.needsUpdate = true;
    for (const m of meshes) m.count = got.near;
    far.count = got.far;
  }
  return { group, update, dispose: () => disposeAll(group) };
}

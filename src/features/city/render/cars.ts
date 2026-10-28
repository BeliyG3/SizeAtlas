/**
 * The traffic as instanced cars: the model's parts merged by material into one instanced mesh
 * each, all sharing one set of instance matrices.
 */
import {
  Box3,
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
): { group: Group; update(t: Traffic): void; dispose(): void } {
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

  const matrix = new Matrix4();
  const at = new Vector3();
  const turn = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  function update(t: Traffic) {
    const n = Math.min(t.count, max);
    for (let i = 0; i < n; i++) {
      turn.setFromAxisAngle(up, t.heading[i]); // the model faces +z, as `heading` measures
      matrix.compose(at.set(t.x[i], t.y[i], t.z[i]), turn, one).toArray(matrices.array, i * 16);
    }
    matrices.needsUpdate = true;
    for (const m of meshes) m.count = n;
  }
  return { group, update, dispose: () => disposeAll(group) };
}

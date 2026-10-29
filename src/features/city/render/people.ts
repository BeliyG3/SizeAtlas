/**
 * The residents as instanced figures: near the camera the walker model in one of a few baked poses
 * of its walk, farther off a plain column; each figure coloured by its role.
 */
import {
  AnimationMixer,
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { NEAR, splitNear, type Residents } from "../actors/residents";
import { ROLE_COLOR } from "../look";
import { disposeAll } from "./dispose";

/** Poses baked from the walk cycle; a figure shows the one its phase falls in. */
export const POSES = 8;
/** The far figure: a column this wide, tall and deep, metres. */
export const COLUMN = [0.35, 1.8, 0.25] as const;

/** The far figure's column, standing on y = 0. */
export const columnBox = () => new BoxGeometry(...COLUMN).translate(0, COLUMN[1] / 2, 0);

/**
 * `Walk_Loop` of `walker` frozen at `POSES` even steps of its cycle, as still geometries in the
 * model's own space (standing on y = 0, facing +z).
 */
export function bakeWalk(walker: GLTF): BufferGeometry[] {
  const clip = walker.animations.find((c) => c.name === "Walk_Loop");
  if (!clip) throw new Error("the walker has no Walk_Loop clip");
  const root = clone(walker.scene);
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip).play();
  const skins: SkinnedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof SkinnedMesh) skins.push(o);
  });
  const v = new Vector3();
  const poses: BufferGeometry[] = [];
  for (let k = 0; k < POSES; k++) {
    action.time = (clip.duration * k) / POSES;
    mixer.update(0);
    root.updateMatrixWorld(true);
    const parts = skins.map((skin) => {
      const source = skin.geometry;
      const count = source.getAttribute("position").count;
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        skin
          .getVertexPosition(i, v)
          .applyMatrix4(skin.matrixWorld)
          .toArray(out, i * 3);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(out, 3));
      if (source.index) g.setIndex(source.index.clone());
      return g;
    });
    const pose = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    pose.computeVertexNormals();
    poses.push(pose);
  }
  mixer.uncacheRoot(root);
  return poses;
}

export function peopleInstances(
  walker: GLTF,
  max: number,
): { group: Group; update(r: Residents, camera: Vector3): void; dispose(): void } {
  const material = new MeshBasicMaterial(); // white: the instance colour is the figure's
  const column = columnBox();
  const group = new Group();
  const meshes = [...bakeWalk(walker), column].map((g, k) => {
    const mesh = new InstancedMesh(g, material, max);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // the figures move: a bounding sphere would go stale
    mesh.name = k < POSES ? `walker ${k}` : "walker far";
    group.add(mesh);
    return mesh;
  });
  const far = meshes[POSES];

  const roles = ROLE_COLOR.map((c) => new Color(c));
  const split = { near: new Int32Array(max), far: new Int32Array(max) };
  const counts = new Int32Array(meshes.length);
  const matrix = new Matrix4();
  const at = new Vector3();
  const turn = new Quaternion();
  const size = new Vector3();
  const up = new Vector3(0, 1, 0);

  // A moved figure grows in from nothing (`appear`).
  function put(r: Residents, i: number, mesh: InstancedMesh, slot: number) {
    turn.setFromAxisAngle(up, r.heading[i]);
    size.setScalar(r.appear[i]);
    mesh.setMatrixAt(slot, matrix.compose(at.set(r.x[i], r.y[i], r.z[i]), turn, size));
    mesh.setColorAt(slot, roles[r.role[i]] ?? roles[0]);
  }

  function update(r: Residents, camera: Vector3) {
    const n = Math.min(r.count, max);
    const got = splitNear(r, n, camera, NEAR, split);
    counts.fill(0);
    for (let k = 0; k < got.near; k++) {
      const i = split.near[k];
      const pose = Math.min(POSES - 1, Math.floor(r.phase[i] * POSES));
      put(r, i, meshes[pose], counts[pose]++);
    }
    for (let k = 0; k < got.far; k++) put(r, split.far[k], far, counts[POSES]++);
    meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
  return { group, update, dispose: () => disposeAll(group) };
}

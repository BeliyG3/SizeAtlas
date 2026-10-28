import { InstancedMesh, Line, Mesh, type Material, type Object3D } from "three";

/** Frees the geometries and materials of every mesh and line under `root`, shared ones once. */
export function disposeAll(root: Object3D) {
  const freed = new Set<{ dispose(): void }>();
  root.traverse((o) => {
    if (!(o instanceof Mesh) && !(o instanceof Line)) return;
    if (o instanceof InstancedMesh) o.dispose(); // its instance buffers
    const materials: Material[] = [].concat(o.material);
    for (const item of [o.geometry, ...materials]) {
      if (!freed.has(item)) item.dispose();
      freed.add(item);
    }
  });
}

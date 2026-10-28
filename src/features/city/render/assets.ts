/** The city's models, loaded once: the car and the walking resident with its clips. */
import type { Object3D } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

export interface Assets {
  car: Object3D;
  walker: GLTF;
}

let loading: Promise<Assets> | null = null;

/** Both models; a failed load is not kept, so the next call tries again. */
export function loadAssets(): Promise<Assets> {
  if (!loading) {
    const loader = new GLTFLoader();
    loading = Promise.all([
      loader.loadAsync(new URL("../assets/skycar.glb", import.meta.url).href),
      loader.loadAsync(new URL("../assets/walker.glb", import.meta.url).href),
    ]).then(
      ([car, walker]) => ({ car: car.scene, walker }),
      (e: unknown) => {
        loading = null;
        throw e;
      },
    );
  }
  return loading;
}

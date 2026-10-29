/**
 * The player's figure: the walker model with a dark body and glowing edges, its clips cross-faded
 * by the pace and played at the speed it moves.
 */
import {
  AnimationMixer,
  Group,
  MeshBasicMaterial,
  SkinnedMesh,
  type AnimationAction,
  type Material,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { LOOK } from "../look";
import { carBody } from "../render/cars";
import { GAIT, type Gait } from "./walk";

const CLIPS: Record<Gait, string> = {
  idle: "Idle_Loop",
  walk: "Walk_Loop",
  jog: "Jog_Fwd_Loop",
  sprint: "Sprint_Loop",
  // No jump clips yet: in the air the run holds still.
  air: "Jog_Fwd_Loop",
};
const FADE = 0.25;
const FADE_AIR = 0.1;

export interface Character {
  group: Group;
  /** Stands at (x, y, z) facing `face`, in `gait` at `speed` m/s; the clips move on by `dt`. */
  update(
    x: number,
    y: number,
    z: number,
    face: number,
    gait: Gait,
    speed: number,
    dt: number,
  ): void;
  dispose(): void;
}

export function createCharacter(walker: GLTF): Character {
  const model = clone(walker.scene);
  const body = carBody();
  const wire = new MeshBasicMaterial({
    color: LOOK.wire,
    wireframe: true,
    transparent: true,
    opacity: 0.75,
  });
  const skins: SkinnedMesh[] = [];
  model.traverse((o) => {
    if (o instanceof SkinnedMesh) skins.push(o);
  });
  for (const o of skins) {
    o.material = body;
    o.frustumCulled = false; // the pose moves past the bind pose's bounds
    // The edges: the same geometry as a wireframe on the same skeleton.
    const edges = new SkinnedMesh(o.geometry, wire);
    edges.frustumCulled = false;
    edges.bind(o.skeleton, o.bindMatrix);
    o.parent?.add(edges);
  }
  const group = new Group();
  group.add(model);

  const mixer = new AnimationMixer(model);
  const actions = new Map<string, AnimationAction>();
  for (const name of new Set(Object.values(CLIPS))) {
    const clip = walker.animations.find((c) => c.name === name);
    if (clip) actions.set(name, mixer.clipAction(clip));
  }
  let gait: Gait = "idle";
  actions.get(CLIPS.idle)?.play();

  const setGait = (next: Gait) => {
    const was = actions.get(CLIPS[gait]);
    const now = actions.get(CLIPS[next]);
    if (now && now !== was) {
      now.reset().play();
      if (was) now.crossFadeFrom(was, next === "air" ? FADE_AIR : FADE, false);
    }
    gait = next;
  };

  return {
    group,
    update(x, y, z, face, next, speed, dt) {
      group.position.set(x, y, z);
      group.rotation.y = face;
      if (next !== gait) setGait(next);
      const action = actions.get(CLIPS[gait]);
      if (action) {
        action.paused = gait === "air";
        if (gait !== "idle" && gait !== "air") {
          action.timeScale = Math.min(1.4, Math.max(0.35, speed / GAIT[gait]));
        }
      }
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      // The geometry is the shared model's; only the looks are this figure's own.
      for (const m of [body, wire] as Material[]) m.dispose();
    },
  };
}

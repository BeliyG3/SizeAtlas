/**
 * The player's figure: the walker model with a dark body and glowing edges, its clips cross-faded
 * by the pace and played at the speed it moves; or posed by a script, getting into a car or out.
 */
import {
  AnimationMixer,
  Group,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  type AnimationAction,
  type Material,
  type Object3D,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { LOOK } from "../look";
import { carBody } from "../render/cars";
import type { ScriptPose } from "./boardingScript";
import type { Arm } from "./carRig";
import { GAIT, type Gait } from "./walk";

const CLIPS: Record<Gait, string> = {
  idle: "Idle_Loop",
  walk: "Walk_Loop",
  jog: "Jog_Fwd_Loop",
  sprint: "Sprint_Loop",
  // No jump clips yet: in the air the run holds still.
  air: "Jog_Fwd_Loop",
};
/** The clips of getting in and out (see `boardingScript`); the loops are among the gaits'. */
const CAR_CLIPS = ["Enter_Car", "Exit_Car"];
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
  /** Posed by a script at `p` (where it stands is the caller's); the gaits resume with `update`. */
  pose(p: ScriptPose): void;
  /** The arms, left then right, for the hands on the yoke (see `holdYoke`). */
  arms: readonly [Arm, Arm];
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
  for (const name of new Set([...Object.values(CLIPS), ...CAR_CLIPS])) {
    const clip = walker.animations.find((c) => c.name === name);
    if (clip) actions.set(name, mixer.clipAction(clip));
  }
  let gait: Gait = "idle";
  actions.get(CLIPS.idle)?.play();
  let scripted = false;
  const named = [...actions];

  const bone = (name: string) => {
    const b = model.getObjectByName(name);
    if (!b) throw new Error(`The walker has no ${name}`);
    return b;
  };
  const arm = (s: string): Arm => ({
    up: bone(`upperarm_${s}`),
    lo: bone(`lowerarm_${s}`),
    hand: bone(`hand_${s}`),
  });
  const arms = [arm("l"), arm("r")] as const;
  // The mixer writes a bone only when its blended value changed since the last update, so an arm
  // bent on top of the clip (the grip) would keep the last frame's bend and bend again: the
  // clip's value is put back on those it left alone.
  const bent: { b: Object3D; clip: Quaternion; left: Quaternion; known: boolean }[] = arms
    .flatMap((a) => [a.up, a.lo])
    .map((b) => ({ b, clip: new Quaternion(), left: new Quaternion(), known: false }));

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
    arms,
    pose(p) {
      if (!scripted) {
        scripted = true;
        for (const a of actions.values()) a.play();
        for (const k of bent) k.known = false;
      }
      for (const k of bent) k.left.copy(k.b.quaternion);
      for (const [name, a] of named) {
        const w = (name === p.a ? p.aw : 0) + (name === p.b ? p.bw : 0);
        a.setEffectiveWeight(w);
        if (w > 0) {
          const t = name === p.a ? p.at : p.bt;
          const len = a.getClip().duration;
          a.time = name.endsWith("_Loop") ? t % len : Math.min(t, len - 1e-3);
        }
      }
      mixer.update(0);
      for (const k of bent) {
        if (k.known && k.b.quaternion.equals(k.left)) k.b.quaternion.copy(k.clip);
        k.clip.copy(k.b.quaternion);
        k.known = true;
      }
    },
    update(x, y, z, face, next, speed, dt) {
      if (scripted) {
        // Back to the gaits, from the idle.
        scripted = false;
        for (const a of actions.values()) a.stop().setEffectiveWeight(1);
        gait = "idle";
        actions.get(CLIPS.idle)?.play();
      }
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
      for (const skeleton of new Set(skins.map((o) => o.skeleton))) skeleton.dispose();
      // The geometry is the shared model's; only the looks are this figure's own.
      for (const m of [body, wire] as Material[]) m.dispose();
    },
  };
}

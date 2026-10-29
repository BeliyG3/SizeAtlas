/**
 * The player's car as a rig: its doors swing, the yoke and the front wheels steer, and the
 * driver's hands hold the yoke's grips (two-bone IK on the clip's arms). Nothing is allocated per
 * frame.
 */
import { MathUtils, Quaternion, Vector3, type Object3D } from "three";

export interface CarRig {
  /** The model in its own frame (see `MODEL_SCALE`): the person is put in it to get in and out. */
  model: Object3D;
  /** The doors from shut (0) to open (1). */
  door(a: number): void;
  /** The yoke about its column and the front wheels, -1..1, right is positive. */
  steer(t: number): void;
  /** Where the hands hold the yoke: left, right. */
  grips: readonly [Object3D, Object3D];
}

/** An arm's bones, from the shoulder. */
export interface Arm {
  up: Object3D;
  lo: Object3D;
  hand: Object3D;
}

const deg = MathUtils.degToRad;

/** The rig of `model`, a clone of skycar.glb: door nodes carry their hinge in extras. */
export function rigCar(model: Object3D): CarRig {
  const doors: { node: Object3D; shut: Quaternion; swing: number }[] = [];
  const wheels: { node: Object3D; max: number }[] = [];
  model.traverse((o) => {
    const x = o.userData as {
      hinge_axis?: string;
      open_sign?: number;
      open_angle_deg?: number;
      steer_max_deg?: number;
    };
    if (x.hinge_axis) {
      doors.push({
        node: o,
        shut: o.quaternion.clone(),
        swing: (x.open_sign ?? 1) * deg(x.open_angle_deg ?? 0),
      });
    }
    if (/^Wheel_[LR]F$/.test(o.name) && x.steer_max_deg) {
      // The hub only: steer about Y outside the spin.
      o.rotation.order = "YXZ";
      wheels.push({ node: o, max: deg(x.steer_max_deg) });
    }
  });
  const yoke = model.getObjectByName("Yoke");
  const grip = (side: string) => model.getObjectByName(`Grip_${side}`);
  const gl = grip("L");
  const gr = grip("R");
  if (!yoke || !gl || !gr) throw new Error("The car model has no yoke");
  const straight = yoke.quaternion.clone();
  const yokeMax = deg((yoke.userData as { steer_max_deg?: number }).steer_max_deg ?? 30);
  return {
    model,
    grips: [gl, gr],
    door(a) {
      for (const d of doors) {
        d.node.quaternion.copy(d.shut);
        d.node.rotateX(d.swing * a);
      }
    },
    steer(t) {
      yoke.quaternion.copy(straight);
      yoke.rotateZ(t * yokeMax);
      for (const w of wheels) w.node.rotation.y = -t * w.max;
    },
  };
}

const cq = new Quaternion();
const clipUp = new Quaternion();
const clipLo = new Quaternion();
const solved = new Quaternion();
const shoulder = new Vector3();
const target = new Vector3();
const pole = new Vector3();
const OUT = [1, -1] as const;

/**
 * The hands onto `rig`'s grips, `w` of the way from the clip's arms (0) to the wrists on them
 * (1): solved by two-bone IK, elbows down and out, so they stay on the yoke whatever the body's
 * proportions and follow it as it turns. In between the bones are blended, not re-solved: an IK
 * onto a target near the clip's own wrist still puts the elbow its own way, and letting go at
 * w = 0 would snap it back. Call after the pose, with the world matrices up to date.
 */
export function holdYoke(arms: readonly [Arm, Arm], rig: CarRig, w: number): void {
  if (w <= 0) return;
  rig.model.getWorldQuaternion(cq);
  for (let i = 0; i < 2; i++) {
    const a = arms[i];
    clipUp.copy(a.up.quaternion);
    clipLo.copy(a.lo.quaternion);
    a.up.getWorldPosition(shoulder);
    rig.grips[i].getWorldPosition(target);
    pole
      .set(OUT[i] * 0.35, -0.6, 0)
      .applyQuaternion(cq)
      .add(shoulder);
    reach(a, target, pole);
    if (w < 1) {
      a.up.quaternion.slerpQuaternions(clipUp, solved.copy(a.up.quaternion), w);
      a.lo.quaternion.slerpQuaternions(clipLo, solved.copy(a.lo.quaternion), w);
      a.up.updateMatrixWorld(true);
    }
  }
}

const A = new Vector3();
const B = new Vector3();
const C = new Vector3();
const E = new Vector3();
const dir = new Vector3();
const bend = new Vector3();
const to = new Vector3();

/** Two-bone IK by swings: the upper bone turned so the elbow lands toward `towards`, then the lower onto `at`. */
function reach(arm: Arm, at: Vector3, towards: Vector3) {
  arm.up.getWorldPosition(A);
  arm.lo.getWorldPosition(B);
  arm.hand.getWorldPosition(C);
  const a = A.distanceTo(B);
  const b = B.distanceTo(C);
  const d = MathUtils.clamp(A.distanceTo(at), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  dir.subVectors(at, A).normalize();
  bend.subVectors(towards, A);
  bend.addScaledVector(dir, -bend.dot(dir)).normalize();
  const cos = (a * a + d * d - b * b) / (2 * a * d);
  E.copy(A)
    .addScaledVector(dir, a * cos)
    .addScaledVector(bend, a * Math.sqrt(1 - cos * cos));
  swing(arm.up, B.sub(A), to.subVectors(E, A));
  arm.hand.getWorldPosition(C);
  swing(arm.lo, C.sub(E), to.subVectors(at, E));
}

const q = new Quaternion();
const pw = new Quaternion();
const bw = new Quaternion();

/** Turns `bone` in world space so the direction `from` becomes `onto`. */
function swing(bone: Object3D, from: Vector3, onto: Vector3) {
  q.setFromUnitVectors(from.normalize(), onto.normalize());
  bone.parent!.getWorldQuaternion(pw);
  bone.getWorldQuaternion(bw);
  bone.quaternion.copy(pw.invert().multiply(q.multiply(bw)));
  bone.updateMatrixWorld(true);
}

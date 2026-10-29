/**
 * Getting in and out as a script of phases that can be posed at any time: which clips play and
 * where, where the person stands in the car's frame, the door, the hands on the yoke and how far
 * the person is fitted to the car's scale; pure, no three.js, and posing allocates nothing.
 */
import { CLIP, type Spot } from "./boarding";

export type ClipName = "Idle_Loop" | "Walk_Loop" | "Enter_Car" | "Exit_Car";

/** Walking to and from the door, m/s; the clip cross-fades, the hands onto the yoke, the door's swing, s. */
const WALK = 1.25;
const BLEND = 0.3;
const GRAB = 0.4;
const DOOR = 0.9;

/** A value held over a phase, or eased from the first to the second. */
type Ramp = number | readonly [number, number];

/**
 * One phase over `d` seconds: the clip, or two cross-faded (`*_Loop` clips run on the script's
 * clock, the others from `clipAt` at the phase start); where the person stands (`walk`: at a
 * constant speed); its yaw; the door (0 shut); the grip on the yoke (0 the clip's arms, 1 the
 * hands on it); `fit`: 0 the person's own size, 1 fitted to the car (see `MODEL_SCALE`).
 */
interface Step {
  d: number;
  clip: ClipName | readonly [ClipName, ClipName];
  clipAt?: number;
  root: Spot | readonly [Spot, Spot];
  walk?: boolean;
  yaw?: Ramp;
  door?: Ramp;
  ik?: Ramp;
  fit?: Ramp;
}

export interface Script {
  /** Seconds. */
  length: number;
  phases: readonly (Step & { t0: number })[];
}

/** The pose at a time: clip `a` at weight `aw` and time `at`, `b` likewise; the rest as in a step. */
export interface ScriptPose {
  a: ClipName;
  aw: number;
  at: number;
  b: ClipName;
  bw: number;
  bt: number;
  x: number;
  z: number;
  yaw: number;
  door: number;
  ik: number;
  fit: number;
}

export const makeScriptPose = (): ScriptPose => ({
  a: "Idle_Loop",
  aw: 1,
  at: 0,
  b: "Idle_Loop",
  bw: 0,
  bt: 0,
  x: 0,
  z: 0,
  yaw: 0,
  door: 0,
  ik: 0,
  fit: 0,
});

/** At the yoke: the last frame of getting in, the hands on it. */
export const SEATED: ScriptPose = {
  ...makeScriptPose(),
  a: "Enter_Car",
  at: CLIP.enter.length - 1e-3,
  b: "Enter_Car",
  x: CLIP.enter.x,
  z: CLIP.enter.z,
  yaw: CLIP.enter.yaw,
  ik: 1,
  fit: 1,
};

function script(steps: Step[]): Script {
  let t0 = 0;
  const phases = steps.map((s) => {
    const p = { ...s, t0 };
    t0 += s.d;
    return p;
  });
  return { length: t0, phases };
}

const ease = (s: number) => s * s * (3 - 2 * s);
const num = (v: Ramp | undefined, e: number) =>
  v === undefined ? 0 : typeof v === "number" ? v : v[0] + (v[1] - v[0]) * e;
const LENGTH: Record<ClipName, number> = {
  Idle_Loop: 0,
  Walk_Loop: 0,
  Enter_Car: CLIP.enter.length,
  Exit_Car: CLIP.exit.length,
};
/** A clip's time `into` a phase: a loop's is the script's clock (the figure wraps it). */
const clipTime = (n: ClipName, t: number, at: number) =>
  n.endsWith("_Loop") ? t : Math.min(at, LENGTH[n] - 1e-3);

/** `s` posed at `t` seconds (held at its ends), written to `out`. */
export function poseAt(s: Script, t: number, out: ScriptPose): ScriptPose {
  let ph = s.phases[s.phases.length - 1];
  for (const q of s.phases) {
    if (t < q.t0 + q.d) {
      ph = q;
      break;
    }
  }
  const k = Math.min(1, Math.max(0, (t - ph.t0) / ph.d));
  const e = ease(k);
  const into = (ph.clipAt ?? 0) + Math.min(Math.max(0, t - ph.t0), ph.d);
  const [a, b] = typeof ph.clip === "string" ? [ph.clip, ph.clip] : ph.clip;
  out.a = a;
  out.b = b;
  out.bw = a === b ? 0 : e;
  out.aw = 1 - out.bw;
  out.at = clipTime(a, t, into);
  out.bt = clipTime(b, t, into);
  if ("x" in ph.root) {
    out.x = ph.root.x;
    out.z = ph.root.z;
  } else {
    const r = ph.walk ? k : e;
    out.x = ph.root[0].x + (ph.root[1].x - ph.root[0].x) * r;
    out.z = ph.root[0].z + (ph.root[1].z - ph.root[0].z) * r;
  }
  out.yaw = num(ph.yaw, e);
  out.door = num(ph.door, e);
  out.ik = num(ph.ik, e);
  out.fit = num(ph.fit, e);
  return out;
}

const IN: Spot = { x: CLIP.enter.x, z: CLIP.enter.z };
const OUT: Spot = { x: CLIP.exit.x, z: CLIP.exit.z };
const heading = (a: Spot, b: Spot) => Math.atan2(b.x - a.x, b.z - a.z);
/** `to`, the short way round from `from`. */
const toward = (from: number, to: number) =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Getting in by the driver's door from where the person stands (`from`, facing `yaw`, in the
 * car's frame): a step to where `Enter_Car` starts as the door opens, the clip with the hands
 * brought onto the yoke at its end, and the door shuts. The person shrinks to the car's scale on
 * the way.
 */
export function enterScript(from: Spot, yaw: number): Script {
  const lenIn = CLIP.enter.length;
  const getIn = (y: number): Step[] => {
    const at = { root: IN, yaw: toward(y, CLIP.enter.yaw), fit: 1 };
    return [
      { d: BLEND, clip: ["Idle_Loop", "Enter_Car"], ...at, door: 1 },
      { d: lenIn - BLEND - GRAB, clip: "Enter_Car", clipAt: BLEND, ...at, door: 1 },
      { d: GRAB, clip: "Enter_Car", clipAt: lenIn - GRAB, ...at, door: 1, ik: [0, 1] },
      // Seated: the door shuts.
      { d: DOOR, clip: "Enter_Car", clipAt: lenIn, ...at, door: [1, 0], ik: 1 },
    ];
  };
  const start = { x: from.x, z: from.z };
  const dist = Math.hypot(IN.x - start.x, IN.z - start.z);
  if (dist < 0.3) {
    // Close by: a shuffle onto the spot, turning to face it, as the door opens.
    const turned = toward(yaw, CLIP.enter.yaw);
    return script([
      {
        d: DOOR,
        clip: "Idle_Loop",
        root: [start, IN],
        yaw: [yaw, turned],
        door: [0, 1],
        fit: [0, 1],
      },
      ...getIn(turned),
    ]);
  }
  const go = toward(yaw, heading(start, IN));
  const turned = toward(go, CLIP.enter.yaw);
  return script([
    { d: 0.35, clip: ["Idle_Loop", "Walk_Loop"], root: start, yaw: [yaw, go] },
    {
      d: dist / WALK,
      clip: "Walk_Loop",
      root: [start, IN],
      walk: true,
      yaw: go,
      door: [0, 0.8],
      fit: [0, 1],
    },
    {
      d: 0.45,
      clip: ["Walk_Loop", "Idle_Loop"],
      root: IN,
      yaw: [go, turned],
      door: [0.8, 1],
      fit: 1,
    },
    ...getIn(turned),
  ]);
}

/**
 * Getting out by the driver's door: it opens, `Exit_Car` (out over the sill, turned away from the
 * car), then a walk to `to` (in the car's frame) as the door shuts, growing back to the person's
 * own size; without `to` the person stands by the door as it shuts.
 */
export function exitScript(to: Spot | null): Script {
  const lenIn = CLIP.enter.length;
  const lenOut = CLIP.exit.length;
  const out = { root: OUT, yaw: CLIP.exit.yaw, fit: 1 };
  const steps: Step[] = [
    // Seated: the door opens.
    {
      d: DOOR,
      clip: "Enter_Car",
      clipAt: lenIn,
      root: IN,
      yaw: CLIP.enter.yaw,
      door: [0, 1],
      ik: 1,
      fit: 1,
    },
    { d: GRAB, clip: "Exit_Car", ...out, door: 1, ik: [1, 0] },
    { d: lenOut - GRAB - BLEND, clip: "Exit_Car", clipAt: GRAB, ...out, door: 1 },
    { d: BLEND, clip: ["Exit_Car", "Idle_Loop"], clipAt: lenOut - BLEND, ...out, door: 1 },
  ];
  if (!to) steps.push({ d: DOOR, clip: "Idle_Loop", ...out, door: [1, 0], fit: [1, 0] });
  else {
    const dist = Math.hypot(to.x - OUT.x, to.z - OUT.z);
    const go = toward(CLIP.exit.yaw, heading(OUT, to));
    steps.push({
      d: Math.max(DOOR, dist / WALK),
      clip: ["Idle_Loop", "Walk_Loop"],
      root: [OUT, { x: to.x, z: to.z }],
      walk: true,
      yaw: [CLIP.exit.yaw, go],
      door: [1, 0],
      fit: [1, 0],
    });
  }
  return script(steps);
}

/**
 * Out over the back, both sides shut: no clip for it, so the person lets go of the yoke and is
 * then standing at `to` (in the car's frame), facing away from the car.
 */
// ponytail: a cut, not a climb; a clip over the back would replace it (stage 2e, animation).
export function backScript(to: Spot): Script {
  const seated = {
    clip: "Enter_Car",
    clipAt: CLIP.enter.length,
    root: IN,
    yaw: CLIP.enter.yaw,
  } as const;
  return script([
    { d: GRAB, ...seated, ik: [1, 0], fit: 1 },
    { d: DOOR, clip: "Idle_Loop", root: to, yaw: Math.atan2(to.x, to.z), fit: [1, 0] },
  ]);
}

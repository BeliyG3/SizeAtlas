/**
 * Short glowing trails behind the cars' tail lights: a flat ribbon along where the light has been
 * over the last `TRAIL_SECONDS`, so it bends through a turn and shrinks to nothing as the car
 * stops. One mesh, one draw, for every trail.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  type Vector3,
} from "three";
import type { Traffic } from "../actors/traffic";
import { LOOK } from "../look";
import { CAR_MID } from "./cars";

/** A trail is where the light was over this many seconds... */
export const TRAIL_SECONDS = 0.4;
/** ...kept as this many samples of it. */
export const TRAIL_POINTS = 8;
/** The ribbon is this wide, metres. */
export const TRAIL_WIDTH = 0.5;
/** Brightness at the light; it fades to nothing at the trail's end. */
export const TRAIL_GLOW = 0.8;
/** A car that moves farther than this in a step has jumped: its trail starts afresh, metres. */
export const TRAIL_JUMP = 20;

// Ribbon points of a trail: the light now, then its samples.
const POINTS = TRAIL_POINTS + 1;
// Seconds between two samples: the samples always reach `TRAIL_SECONDS` back.
const SAMPLE = TRAIL_SECONDS / (TRAIL_POINTS - 1);

/** Trails of up to `max` cars whose light is at `tail` in the car's own space. */
export function trailMesh(
  max: number,
  tail: Vector3,
): { mesh: Mesh; update(t: Traffic, camera: Vector3, dt: number): void; dispose(): void } {
  const position = new BufferAttribute(new Float32Array(max * POINTS * 6), 3);
  const color = new BufferAttribute(new Float32Array(max * POINTS * 6), 3);
  position.setUsage(DynamicDrawUsage);
  color.setUsage(DynamicDrawUsage);
  const index: number[] = [];
  for (let slot = 0; slot < max; slot++) {
    for (let k = 0; k < POINTS - 1; k++) {
      const v = (slot * POINTS + k) * 2;
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", color);
  geometry.setIndex(index);
  geometry.setDrawRange(0, 0);
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // the trails move: a bounding sphere would go stale
  mesh.name = "car trails";

  // Each car's samples, a ring from `head` (the newest) back over `len` of them.
  const sx = new Float32Array(max * TRAIL_POINTS);
  const sy = new Float32Array(max * TRAIL_POINTS);
  const sz = new Float32Array(max * TRAIL_POINTS);
  const st = new Float64Array(max * TRAIL_POINTS);
  const head = new Int32Array(max);
  const len = new Int32Array(max);
  // Where each light was in the last step, to see a jump.
  const last = new Float32Array(max * 3);
  const red = new Color(LOOK.virus);
  let traffic: Traffic | null = null;
  let now = 0;

  // The ribbon points of one trail: where they are and how old.
  const px = new Float32Array(POINTS);
  const py = new Float32Array(POINTS);
  const pz = new Float32Array(POINTS);
  const age = new Float32Array(POINTS);

  /** The points of the trail of car `i`, its light at (x, y, z) now, cut at `TRAIL_SECONDS`. */
  function points(i: number, x: number, y: number, z: number): number {
    px[0] = x;
    py[0] = y;
    pz[0] = z;
    age[0] = 0;
    let m = 1;
    for (let k = 0; k < len[i]; k++) {
      const s = i * TRAIL_POINTS + ((head[i] - k + TRAIL_POINTS) % TRAIL_POINTS);
      const a = now - st[s];
      if (a >= TRAIL_SECONDS) {
        // The end, between this sample and the one before.
        const f = (TRAIL_SECONDS - age[m - 1]) / (a - age[m - 1] || 1);
        px[m] = px[m - 1] + (sx[s] - px[m - 1]) * f;
        py[m] = py[m - 1] + (sy[s] - py[m - 1]) * f;
        pz[m] = pz[m - 1] + (sz[s] - pz[m - 1]) * f;
        age[m++] = TRAIL_SECONDS;
        break;
      }
      px[m] = sx[s];
      py[m] = sy[s];
      pz[m] = sz[s];
      age[m++] = a;
    }
    return m;
  }

  /** Writes the ribbon of `m` points into `slot`; the points it does not use sit on its end. */
  function ribbon(slot: number, m: number, heading: number) {
    const p = position.array as Float32Array;
    const c = color.array as Float32Array;
    for (let k = 0; k < POINTS; k++) {
      const j = Math.min(k, m - 1);
      // Across the way the trail runs here; along the car where it has no length.
      const a = Math.max(0, Math.min(j, m - 2));
      let dx = px[a + 1] - px[a];
      let dz = pz[a + 1] - pz[a];
      const d = Math.hypot(dx, dz);
      if (m < 2 || d < 1e-6) [dx, dz] = [Math.sin(heading), Math.cos(heading)];
      else [dx, dz] = [dx / d, dz / d];
      const w = TRAIL_WIDTH / 2;
      const v = (slot * POINTS + k) * 6;
      p.set([px[j] - dz * w, py[j], pz[j] + dx * w, px[j] + dz * w, py[j], pz[j] - dx * w], v);
      const glow = k < m ? TRAIL_GLOW * Math.max(0, 1 - age[j] / TRAIL_SECONDS) : 0;
      c.set(
        [red.r * glow, red.g * glow, red.b * glow, red.r * glow, red.g * glow, red.b * glow],
        v,
      );
    }
  }

  function update(t: Traffic, camera: Vector3, dt: number) {
    if (t !== traffic) {
      traffic = t;
      len.fill(0);
    }
    now += dt;
    const mid2 = CAR_MID * CAR_MID;
    let slots = 0;
    for (let i = 0; i < Math.min(t.count, max); i++) {
      // The light: the tail point turned by the heading, as the model is.
      const sin = Math.sin(t.heading[i]);
      const cos = Math.cos(t.heading[i]);
      const x = t.x[i] + tail.x * cos + tail.z * sin;
      const y = t.y[i] + tail.y;
      const z = t.z[i] - tail.x * sin + tail.z * cos;
      const moved = Math.hypot(x - last[i * 3], y - last[i * 3 + 1], z - last[i * 3 + 2]);
      if (t.appear[i] < 1 || moved > TRAIL_JUMP) len[i] = 0;
      last.set([x, y, z], i * 3);
      if (!len[i] || now - st[i * TRAIL_POINTS + head[i]] >= SAMPLE) {
        head[i] = (head[i] + 1) % TRAIL_POINTS;
        const s = i * TRAIL_POINTS + head[i];
        [sx[s], sy[s], sz[s], st[s]] = [x, y, z, now];
        len[i] = Math.min(len[i] + 1, TRAIL_POINTS);
      }
      const d2 = (t.x[i] - camera.x) ** 2 + (t.y[i] - camera.y) ** 2 + (t.z[i] - camera.z) ** 2;
      if (d2 > mid2) continue;
      ribbon(slots++, points(i, x, y, z), t.heading[i]);
    }
    geometry.setDrawRange(0, slots * (POINTS - 1) * 6);
    position.needsUpdate = color.needsUpdate = true;
  }

  return {
    mesh,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

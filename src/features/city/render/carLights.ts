/**
 * The lights of the cars one sees: a tail light at the back and a head light at the front of every
 * car, as bright as the car has grown in. One set of points, one draw, placed on the CPU each frame.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  type Points,
  Vector3,
} from "three";
import type { Traffic } from "../actors/traffic";
import { LOOK } from "../look";
import { CAR_LIGHT_BRIGHT, LIGHT_CLEAR, LIGHT_MIN_PX, LIGHT_VERTEX, lightPoints } from "./lights";

const VERTEX = `${LIGHT_VERTEX}
attribute vec3 lightColor;
varying vec3 vColor;
varying float vFade;
void main() {
	vColor = lightColor;
	vFade = 1.0;
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	gl_PointSize = lightPx( mvPosition.z );
}`;

const TAIL = new Color(LOOK.virus);
const HEAD = new Color(LOOK.wire);

/**
 * Lights for up to `max` cars whose tail light is at `tail` in the car's own space (the head light
 * mirrors it along the car).
 */
export function carLights(
  max: number,
  tail: Vector3,
): { points: Points; update(t: Traffic): void; dispose(): void } {
  const position = new BufferAttribute(new Float32Array(max * 6), 3);
  const color = new BufferAttribute(new Float32Array(max * 6), 3);
  position.setUsage(DynamicDrawUsage);
  color.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("lightColor", color);
  geometry.setDrawRange(0, 0);
  const points = lightPoints(
    geometry,
    VERTEX,
    {},
    { minPx: LIGHT_MIN_PX, bright: CAR_LIGHT_BRIGHT },
    "car lights",
  );
  const p = position.array as Float32Array;
  const c = color.array as Float32Array;
  const head = headOf(tail);

  function update(t: Traffic) {
    let slots = 0;
    for (let i = 0; i < Math.min(t.count, max); i++) {
      if (!t.live[i]) continue; // off the roads: no light
      const sin = Math.sin(t.heading[i]);
      const cos = Math.cos(t.heading[i]);
      const glow = t.appear[i]; // a car grows in: its lights come up with it
      for (let k = 0; k < 2; k++) {
        const v = (slots * 2 + k) * 3;
        // The tail behind, the head ahead, a little clear of the body so it never hides them.
        const along = k === 0 ? tail.z - LIGHT_CLEAR : head.z + LIGHT_CLEAR;
        p[v] = t.x[i] + tail.x * cos + along * sin;
        p[v + 1] = t.y[i] + tail.y;
        p[v + 2] = t.z[i] - tail.x * sin + along * cos;
        const rgb = k === 0 ? TAIL : HEAD;
        c[v] = rgb.r * glow;
        c[v + 1] = rgb.g * glow;
        c[v + 2] = rgb.b * glow;
      }
      slots++;
    }
    geometry.setDrawRange(0, slots * 2);
    position.needsUpdate = color.needsUpdate = true;
  }

  return {
    points,
    update,
    dispose() {
      geometry.dispose();
      (points.material as { dispose(): void }).dispose();
    },
  };
}

/** The head light of a car whose tail light is at `tail`: as far ahead of its middle as that is behind. */
export function headOf(tail: Vector3): Vector3 {
  return new Vector3(tail.x, tail.y, -tail.z);
}

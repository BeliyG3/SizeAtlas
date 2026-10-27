/** Camera framing math of the city; pure, no three.js. */

export type Vec3 = [number, number, number];

/** An axis-aligned box in world units. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** The orbit controls' distance limits; `frame` stays inside them. */
export const MIN_DISTANCE = 1;
export const MAX_DISTANCE = 1500;
/** Room left around a fitted box. */
const MARGIN = 1.1;

/**
 * Camera target and distance that fit the whole `box`, heights included, in view.
 * `fov` is the vertical field of view in degrees (as `PerspectiveCamera.fov`), `aspect`
 * width / height, `polar` and `azimuth` in radians as OrbitControls reports them: the camera
 * sits at `target + setFromSphericalCoords(distance, polar, azimuth)`.
 */
export function frame(
  box: Box,
  fov: number,
  aspect: number,
  polar: number,
  azimuth = 0,
): { target: Vec3; distance: number } {
  const target: Vec3 = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) as Vec3;
  const sp = Math.sin(polar);
  // Toward the camera, the screen's right and its up, as in three's Spherical.
  const back: Vec3 = [sp * Math.sin(azimuth), Math.cos(polar), sp * Math.cos(azimuth)];
  const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  const tanV = Math.tan((fov * Math.PI) / 360) / MARGIN;
  const tanH = tanV * aspect;
  let distance = 0;
  for (let corner = 0; corner < 8; corner++) {
    const p = [0, 1, 2].map((i) => ((corner >> i) & 1 ? box.max[i] : box.min[i]) - target[i]);
    const dot = (v: Vec3) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
    // The corner is `distance - dot(back)` in front of the camera and must fit both half-fovs.
    const need = dot(back) + Math.max(Math.abs(dot(right)) / tanH, Math.abs(dot(up)) / tanV);
    distance = Math.max(distance, need);
  }
  return { target, distance: Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance)) };
}

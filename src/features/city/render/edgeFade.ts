/**
 * Share of a house edge's colour kept at distance `d` from the camera (metres): 1 up to `near`,
 * `floor` from `far` on, a smoothstep between. The vertex/fragment shader in `houses.ts` computes
 * the same formula in GLSL, so keep the two in step.
 */
export function edgeFade(d: number, near: number, far: number, floor: number): number {
  const t = Math.min(1, Math.max(0, (d - near) / (far - near)));
  return 1 - (1 - floor) * t * t * (3 - 2 * t);
}

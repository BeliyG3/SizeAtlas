/**
 * Where a particle of the far crowd is: the GLSL every crowd material places its vertices by, and
 * its TS twin. The two must stay the same.
 */
import type { DataTexture, Vector3 } from "three";
import { ROUTE_POINTS, ROUTE_STEP, type Routes } from "../world/routes";

/** A particle grows in from the circle's radius out to this many radii. */
export const CROWD_FADE = 1.15;

/** Per-particle data, by attribute name: route row, start (m), speed (m/s), side (±1), route length (m). */
export interface Particles {
  crowdRoute: Float32Array;
  crowdS0: Float32Array;
  crowdSpeed: Float32Array;
  crowdSide: Float32Array;
  crowdLen: Float32Array;
}

/** The uniforms `CROWD_PLACE` reads, shared by the materials of a kind so one update moves all. */
export interface CrowdUniforms {
  [name: string]: { value: unknown };
  uRoutes: { value: DataTexture };
  uTime: { value: number };
  uEye: { value: Vector3 };
  uRadius: { value: number };
}

/**
 * Where particle `s0`, `speed` of `route` is at time `t`, `along` metres ahead of its middle (on
 * the way it heads), and that way (`dx`, `dz`, a unit vector). It keeps the route's side offset
 * to the right of the way (`side` 1) or to the left (-1). The TS twin of `crowdPlace` in
 * `CROWD_PLACE`: keep the two the same.
 */
export function crowdAt(
  routes: Routes,
  route: number,
  s0: number,
  speed: number,
  side: number,
  t: number,
  along = 0,
): { x: number; y: number; z: number; dx: number; dz: number } {
  const len = routes.length[route];
  const x = s0 + speed * t;
  const s = x - len * Math.floor(x / len); // GLSL mod
  const i = Math.min(Math.max(Math.floor(s / ROUTE_STEP), 0), len / ROUTE_STEP - 1);
  const f = s / ROUTE_STEP - i;
  const a = (route * ROUTE_POINTS + i) * 4;
  const b = a + 4;
  const p = routes.points;
  const mix = (k: number) => p[a + k] + (p[b + k] - p[a + k]) * f;
  let dx = p[b] - p[a];
  let dz = p[b + 2] - p[a + 2];
  const d = Math.hypot(dx, dz);
  [dx, dz] = d > 1e-4 ? [dx / d, dz / d] : [0, 1];
  // Right of the way is (-dz, dx), as in `pointOn`.
  const off = mix(3) * side;
  return {
    x: mix(0) - dz * off + dx * along,
    y: mix(1),
    z: mix(2) + dx * off + dz * along,
    dx,
    dz,
  };
}

/**
 * The particle's size `distance` metres from the camera: 0 inside `radius`, smoothly up to 1 at
 * `CROWD_FADE` radii. The TS twin of `crowdScale` in `CROWD_PLACE`.
 */
export function crowdShow(distance: number, radius: number): number {
  const t = Math.min(1, Math.max(0, (distance - radius) / (CROWD_FADE * radius - radius)));
  return t * t * (3 - 2 * t);
}

/**
 * The GLSL before a crowd material's `main`: `crowdPlace(along)` sets `crowdPos`, `crowdDir` and
 * `crowdScale` as `crowdAt` and `crowdShow` work them out; `crowdTurn` turns a vector of the
 * model (facing +z) the way the particle heads.
 */
export const CROWD_PLACE = `
uniform highp sampler2D uRoutes;
uniform float uTime;
uniform vec3 uEye;
uniform float uRadius;
attribute float crowdRoute;
attribute float crowdS0;
attribute float crowdSpeed;
attribute float crowdSide;
attribute float crowdLen;
vec3 crowdPos;
vec2 crowdDir;
float crowdScale;
void crowdPlace( float along ) {
	float stride = float( ${ROUTE_STEP} );
	float s = mod( crowdS0 + crowdSpeed * uTime, crowdLen );
	// A float mod can come out a hair below 0: no column -1.
	float i = clamp( floor( s / stride ), 0.0, crowdLen / stride - 1.0 );
	ivec2 at = ivec2( int( i ), int( crowdRoute ) );
	vec4 a = texelFetch( uRoutes, at, 0 );
	vec4 b = texelFetch( uRoutes, at + ivec2( 1, 0 ), 0 );
	vec4 p = mix( a, b, s / stride - i );
	vec2 d = b.xz - a.xz;
	crowdDir = length( d ) > 1e-4 ? normalize( d ) : vec2( 0.0, 1.0 );
	vec3 right = vec3( -crowdDir.y, 0.0, crowdDir.x );
	crowdPos = p.xyz + right * p.w * crowdSide + vec3( crowdDir.x, 0.0, crowdDir.y ) * along;
	crowdScale = smoothstep( uRadius, float( ${CROWD_FADE} ) * uRadius, distance( crowdPos, uEye ) );
}
vec3 crowdTurn( vec3 v ) {
	return vec3( v.x * crowdDir.y + v.z * crowdDir.x, v.y, v.z * crowdDir.y - v.x * crowdDir.x );
}
`;

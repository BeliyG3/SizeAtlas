/**
 * The far crowd: thousands of cars or walkers, one instanced mesh a kind, moved along their routes
 * by the vertex shader. They show only outside the circle the honest actors keep to.
 */
import {
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  Vector2,
  type Material,
} from "three";
import type { Circle } from "../actors/locals";
import { rng } from "../actors/nav";
import { ROLE } from "../actors/residents";
import { ROLE_COLOR } from "../look";
import { ROUTE_POINTS, ROUTE_STEP, type Routes } from "../world/routes";
import { carBody, carBox } from "./cars";
import { disposeAll } from "./dispose";
import { columnBox } from "./people";

/** Speeds of the crowd, m/s, from the first to the second. */
export const CROWD_SPEED = { drive: [10, 22], walk: [1.1, 1.7] } as const;
/** A particle grows in from the circle's radius out to this many radii. */
export const CROWD_FADE = 1.15;

export interface Crowd {
  mesh: InstancedMesh;
  /** Moves the crowd on `dt` seconds; it hides inside `around`, the honest actors' circle. */
  update(dt: number, around: Circle): void;
  dispose(): void;
}

/** `count` particles of `kind` spread over `routes`, the same for the same `seed`. */
export function crowdMesh(
  routes: Routes,
  kind: "drive" | "walk",
  count: number,
  seed: number,
): Crowd {
  const rand = rng(seed);
  const n = routes.count ? Math.max(0, Math.floor(count)) : 0;
  const route = new Float32Array(n);
  const s0 = new Float32Array(n);
  const speed = new Float32Array(n);
  const side = new Float32Array(n);
  const len = new Float32Array(n);
  const [slow, fast] = CROWD_SPEED[kind];
  for (let i = 0; i < n; i++) {
    route[i] = i % routes.count;
    len[i] = routes.length[route[i]];
    s0[i] = rand() * len[i];
    speed[i] = slow + rand() * (fast - slow);
    // Cars keep right; walkers take either sidewalk.
    side[i] = kind === "drive" || rand() < 0.5 ? 1 : -1;
  }
  const geometry = kind === "drive" ? carBox() : columnBox();
  const add = (name: string, values: Float32Array) =>
    geometry.setAttribute(name, new InstancedBufferAttribute(values, 1));
  add("crowdRoute", route);
  add("crowdS0", s0);
  add("crowdSpeed", speed);
  add("crowdSide", side);
  add("crowdLen", len);

  const rows = Math.max(1, routes.count);
  const data = routes.count ? routes.points : new Float32Array(ROUTE_POINTS * 4);
  const texture = new DataTexture(data, ROUTE_POINTS, rows, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const uniforms = {
    uRoutes: { value: texture },
    uTime: { value: 0 },
    uCenter: { value: new Vector2() },
    uRadius: { value: 1 }, // never 0: smoothstep needs its edges apart
  };
  const material =
    kind === "drive" ? carBody() : new MeshBasicMaterial({ color: ROLE_COLOR[ROLE.resident] });
  moveOnGpu(material, uniforms);

  const mesh = new InstancedMesh(geometry, material, Math.max(1, n));
  mesh.count = n;
  mesh.frustumCulled = false; // the shader places them: the bounding sphere knows nothing of it
  mesh.name = kind === "drive" ? "crowd cars" : "crowd people";
  return {
    mesh,
    update(dt, around) {
      // ponytail: a float32 clock; after a day of drawing the crowd steps by ~0.1 m. Wrap it per
      // particle (on the CPU, by its own period) if a panel ever stays open that long.
      uniforms.uTime.value += dt;
      uniforms.uCenter.value.set(around.x, around.z);
      uniforms.uRadius.value = around.r;
    },
    dispose() {
      disposeAll(mesh);
      texture.dispose();
    },
  };
}

/**
 * Where particle `s0`, `speed` of `route` is at time `t`, and the way it heads (`dx`, `dz`, a
 * unit vector). It keeps the route's `side` offset to the right of the way (`side` 1) or to the
 * left (-1). The TS twin of `CROWD_GLSL`'s `crowdPlace`: keep the two the same.
 */
export function crowdAt(
  routes: Routes,
  route: number,
  s0: number,
  speed: number,
  side: number,
  t: number,
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
  return { x: mix(0) - dz * off, y: mix(1), z: mix(2) + dx * off, dx, dz };
}

/**
 * The particle's size `distance` metres (in the plan) from the circle's centre: 0 inside `radius`,
 * smoothly up to 1 at `CROWD_FADE` radii. The TS twin of `crowdScale` in `CROWD_GLSL`.
 */
export function crowdShow(distance: number, radius: number): number {
  const t = Math.min(1, Math.max(0, (distance - radius) / (CROWD_FADE * radius - radius)));
  return t * t * (3 - 2 * t);
}

/** The shader's part: `crowdPlace` and `crowdScale` must match `crowdAt` and `crowdShow`. */
const CROWD_GLSL = `
uniform highp sampler2D uRoutes;
uniform float uTime;
uniform vec2 uCenter;
uniform float uRadius;
attribute float crowdRoute;
attribute float crowdS0;
attribute float crowdSpeed;
attribute float crowdSide;
attribute float crowdLen;
vec3 crowdPos;
vec2 crowdDir;
float crowdScale;
void crowdPlace() {
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
	crowdPos = p.xyz + vec3( -crowdDir.y, 0.0, crowdDir.x ) * p.w * crowdSide;
	crowdScale = smoothstep( uRadius, float( ${CROWD_FADE} ) * uRadius, distance( crowdPos.xz, uCenter ) );
}
// Turned from facing +z to the way it heads.
vec3 crowdTurn( vec3 v ) {
	return vec3( v.x * crowdDir.y + v.z * crowdDir.x, v.y, v.z * crowdDir.y - v.x * crowdDir.x );
}
void main() {
	crowdPlace();`;

/** Makes `material` place each instance by `CROWD_GLSL` (the instance matrices stay identity). */
function moveOnGpu(material: Material, uniforms: Record<string, { value: unknown }>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", CROWD_GLSL)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n\tobjectNormal = crowdTurn( objectNormal );",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\ttransformed = crowdPos + crowdTurn( position * crowdScale );",
      );
  };
}

/**
 * The far crowd: thousands of cars or walkers a kind, as one instanced mesh of bodies and one set
 * of lights, moved along their routes by the vertex shader (`CROWD_PLACE`). They show only past
 * `CROWD_NEAR` from the camera, where the honest cars are no longer drawn with their lights.
 */
import {
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  Vector3,
  type Material,
  type Points,
} from "three";
import { rng } from "../actors/nav";
import { ROLE } from "../actors/residents";
import { ROLE_COLOR } from "../look";
import { ROUTE_POINTS, type Routes } from "../world/routes";
import { CAR_MID, carBody, carBox } from "./cars";
import { crowdLights } from "./crowdLights";
import { CROWD_PLACE, type CrowdUniforms, type Particles } from "./crowdPlace";
import { disposeAll } from "./dispose";
import { columnBox } from "./people";

/** The crowd hides this near the camera, metres: the honest actors are drawn there. */
export const CROWD_NEAR = CAR_MID;
/** Speeds of the crowd, m/s, from the first to the second. */
export const CROWD_SPEED = { drive: [10, 22], walk: [1.1, 1.7] } as const;

export interface Crowd {
  /** The bodies and the lights. */
  group: Group;
  mesh: InstancedMesh;
  lights: Points;
  /** Moves the crowd on `dt` seconds; it hides within `CROWD_NEAR` of the camera at `eye`. */
  update(dt: number, eye: Vector3): void;
  dispose(): void;
}

/** `count` particles of `kind` spread over `routes`, the same for the same `seed`. */
export function crowdMesh(
  routes: Routes,
  kind: "drive" | "walk",
  count: number,
  seed: number,
): Crowd {
  const particles = spread(routes, kind, count, seed);
  const n = particles.crowdRoute.length;
  const geometry = kind === "drive" ? carBox() : columnBox();
  for (const [name, values] of Object.entries(particles)) {
    geometry.setAttribute(name, new InstancedBufferAttribute(values, 1));
  }

  const rows = Math.max(1, routes.count);
  const data = routes.count ? routes.points : new Float32Array(ROUTE_POINTS * 4);
  const texture = new DataTexture(data, ROUTE_POINTS, rows, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const uniforms: CrowdUniforms = {
    uRoutes: { value: texture },
    uTime: { value: 0 },
    uEye: { value: new Vector3() },
    uRadius: { value: CROWD_NEAR },
  };
  const material =
    kind === "drive" ? carBody() : new MeshBasicMaterial({ color: ROLE_COLOR[ROLE.resident] });
  moveOnGpu(material, uniforms);

  const mesh = new InstancedMesh(geometry, material, Math.max(1, n));
  mesh.count = n;
  mesh.frustumCulled = false; // the shader places them: the bounding sphere knows nothing of it
  mesh.name = kind === "drive" ? "crowd cars" : "crowd people";
  const lights = crowdLights(particles, kind, uniforms);
  const group = new Group();
  group.add(mesh, lights);
  return {
    group,
    mesh,
    lights,
    update(dt, eye) {
      // ponytail: a float32 clock; after a day of drawing the crowd steps by ~0.1 m. Wrap it per
      // particle (on the CPU, by its own period) if a panel ever stays open that long.
      uniforms.uTime.value += dt;
      uniforms.uEye.value.copy(eye);
    },
    dispose() {
      disposeAll(group);
      texture.dispose();
    },
  };
}

/** `count` particles of `kind` over `routes`, apart along them; none without routes. */
function spread(routes: Routes, kind: "drive" | "walk", count: number, seed: number): Particles {
  const rand = rng(seed);
  const n = routes.count ? Math.max(0, Math.floor(count)) : 0;
  const p: Particles = {
    crowdRoute: new Float32Array(n),
    crowdS0: new Float32Array(n),
    crowdSpeed: new Float32Array(n),
    crowdSide: new Float32Array(n),
    crowdLen: new Float32Array(n),
  };
  const [slow, fast] = CROWD_SPEED[kind];
  for (let i = 0; i < n; i++) {
    const route = i % routes.count;
    p.crowdRoute[i] = route;
    p.crowdLen[i] = routes.length[route];
    p.crowdS0[i] = rand() * p.crowdLen[i];
    p.crowdSpeed[i] = slow + rand() * (fast - slow);
    // Cars keep right; walkers take either sidewalk.
    p.crowdSide[i] = kind === "drive" || rand() < 0.5 ? 1 : -1;
  }
  return p;
}

/** Makes `material` place each instance by `CROWD_PLACE` (the instance matrices stay identity). */
function moveOnGpu(material: Material, uniforms: CrowdUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${CROWD_PLACE}\nvoid main() {\n\tcrowdPlace( 0.0 );`)
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

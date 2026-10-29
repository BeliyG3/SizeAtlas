/**
 * The far crowd's lights, as at night one sees far cars: a tail light and a head light a car, a
 * dim dot a walker; one set of soft round points a kind, placed by the same GLSL as the bodies.
 */
import { BufferGeometry, Color, Float32BufferAttribute, type Points } from "three";
import { ROLE } from "../actors/residents";
import { LOOK, ROLE_COLOR } from "../look";
import { CAR_BOX, CAR_LENGTH } from "./cars";
import { CROWD_PLACE, type CrowdUniforms, type Particles } from "./crowdPlace";
import { LIGHT_MIN_PX, LIGHT_VERTEX, lightPoints } from "./lights";
import { COLUMN } from "./people";

/**
 * The lights of a kind: where along a particle they sit (metres ahead of its middle) and their
 * colours, how high they are, their least size in pixels and their brightness.
 */
const LIGHTS = {
  drive: {
    // The tail light (the model's `Tail`), then the head light (its `Glow`).
    along: [-CAR_LENGTH / 2, CAR_LENGTH / 2],
    colors: [LOOK.virus, LOOK.wire],
    lift: CAR_BOX[1] / 2,
    minPx: LIGHT_MIN_PX,
    bright: 1,
  },
  walk: {
    along: [0],
    colors: [ROLE_COLOR[ROLE.resident]],
    lift: COLUMN[1] / 2,
    minPx: 1.5,
    bright: 0.5,
  },
} as const;

const VERTEX = `${CROWD_PLACE}${LIGHT_VERTEX}
uniform float uLift;
attribute float crowdAlong;
attribute vec3 lightColor;
varying vec3 vColor;
varying float vFade;
void main() {
	crowdPlace( crowdAlong );
	vColor = lightColor;
	vFade = crowdScale;
	vec4 mvPosition = modelViewMatrix * vec4( crowdPos + vec3( 0.0, uLift, 0.0 ), 1.0 );
	// Inside the circle: off the screen.
	gl_Position = crowdScale > 0.0 ? projectionMatrix * mvPosition : vec4( 2.0, 2.0, 2.0, 1.0 );
	gl_PointSize = lightPx( mvPosition.z );
}`;

/** The lights of `particles` of `kind`, moved by `uniforms` (shared with the bodies). */
export function crowdLights(
  particles: Particles,
  kind: "drive" | "walk",
  uniforms: CrowdUniforms,
): Points {
  const look = LIGHTS[kind];
  const per = look.along.length;
  const n = particles.crowdRoute.length;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(n * per * 3), 3));
  for (const [name, values] of Object.entries(particles) as [string, Float32Array][]) {
    const out = new Float32Array(n * per);
    for (let i = 0; i < out.length; i++) out[i] = values[Math.floor(i / per)];
    geometry.setAttribute(name, new Float32BufferAttribute(out, 1));
  }
  const along = new Float32Array(n * per);
  const colors = new Float32Array(n * per * 3);
  const rgb = look.colors.map((c) => new Color(c));
  for (let i = 0; i < n * per; i++) {
    along[i] = look.along[i % per];
    rgb[i % per].toArray(colors, i * 3);
  }
  geometry.setAttribute("crowdAlong", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("lightColor", new Float32BufferAttribute(colors, 3));

  return lightPoints(
    geometry,
    VERTEX,
    { ...uniforms, uLift: { value: look.lift } },
    look,
    kind === "drive" ? "crowd car lights" : "crowd people lights",
  );
}

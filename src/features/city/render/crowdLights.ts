/**
 * The far crowd's lights, as at night one sees far cars: a tail light and a head light a car, a
 * dim dot a walker; one set of soft round points a kind, placed by the same GLSL as the bodies.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
} from "three";
import { ROLE } from "../actors/residents";
import { LOOK, ROLE_COLOR } from "../look";
import { CAR_BOX, CAR_LENGTH } from "./cars";
import { CROWD_PLACE, type CrowdUniforms, type Particles } from "./crowdPlace";
import { COLUMN } from "./people";

/** A light is drawn this many CSS pixels across at the least and at the most... */
export const LIGHT_MIN_PX = 2;
export const LIGHT_MAX_PX = 5;
/** ...and as this many metres across in between. */
export const LIGHT_SIZE = 0.5;

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

const VERTEX = `${CROWD_PLACE}
uniform float uLift;
uniform float uHalfHeight;
uniform float uRatio;
uniform float uMinPx;
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
	float px = float( ${LIGHT_SIZE} ) * projectionMatrix[ 1 ][ 1 ] * uHalfHeight / -mvPosition.z;
	gl_PointSize = clamp( px, uMinPx * uRatio, float( ${LIGHT_MAX_PX} ) * uRatio );
}`;

const FRAGMENT = `
uniform float uBright;
varying vec3 vColor;
varying float vFade;
void main() {
	// A round dot, soft at its edge.
	float a = 1.0 - smoothstep( 0.3, 1.0, length( gl_PointCoord - 0.5 ) * 2.0 );
	if ( a <= 0.0 ) discard;
	gl_FragColor = vec4( vColor * uBright, a * vFade );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
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

  const own = {
    uLift: { value: look.lift },
    uHalfHeight: { value: 1 },
    uRatio: { value: 1 },
    uMinPx: { value: look.minPx },
    uBright: { value: look.bright },
  };
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, ...own },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false; // the shader places them: the bounding sphere knows nothing of it
  points.name = kind === "drive" ? "crowd car lights" : "crowd people lights";
  // The pixel size follows the canvas: its drawing height and the device's pixel ratio.
  const buffer = new Vector2();
  points.onBeforeRender = (renderer) => {
    own.uHalfHeight.value = renderer.getDrawingBufferSize(buffer).y / 2;
    own.uRatio.value = renderer.getPixelRatio();
  };
  return points;
}

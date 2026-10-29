/**
 * What the far crowd's lights and the near cars' lights share: a soft round point, as big on the
 * screen as a light of `LIGHT_SIZE` metres is (within a few pixels), glowing additively.
 */
import { AdditiveBlending, Points, ShaderMaterial, Vector2, type BufferGeometry } from "three";

/** A light is drawn this many CSS pixels across at the least and at the most... */
export const LIGHT_MIN_PX = 3;
export const LIGHT_MAX_PX = 7;
/** ...and as this many metres across in between. */
export const LIGHT_SIZE = 0.5;
/** A car's lights sit this far out of its ends, metres, so its body never hides them... */
export const LIGHT_CLEAR = 0.15;
/** ...and shine this much over their colour. */
export const CAR_LIGHT_BRIGHT = 1.5;

/**
 * GLSL for a vertex shader: the uniforms of the size and `lightPx( viewZ )`, the point size in
 * drawing pixels of a light at that depth in the view.
 */
export const LIGHT_VERTEX = `
uniform float uHalfHeight;
uniform float uRatio;
uniform float uMinPx;
float lightPx( float viewZ ) {
	float px = float( ${LIGHT_SIZE} ) * projectionMatrix[ 1 ][ 1 ] * uHalfHeight / -viewZ;
	return clamp( px, uMinPx * uRatio, float( ${LIGHT_MAX_PX} ) * uRatio );
}`;

/** The fragment shader: a round dot, soft at its edge, of `vColor` times `uBright`, `vFade` clear. */
export const LIGHT_FRAGMENT = `
uniform float uBright;
varying vec3 vColor;
varying float vFade;
void main() {
	float a = 1.0 - smoothstep( 0.45, 1.0, length( gl_PointCoord - 0.5 ) * 2.0 );
	if ( a <= 0.0 ) discard;
	gl_FragColor = vec4( vColor * uBright, a * vFade );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

/**
 * Points of `geometry` drawn as lights by `vertexShader` (which includes `LIGHT_VERTEX` and sets
 * `vColor` and `vFade`), their least size `minPx` pixels and brightness `bright`; `uniforms` are the
 * shader's own.
 */
export function lightPoints(
  geometry: BufferGeometry,
  vertexShader: string,
  uniforms: ShaderMaterial["uniforms"],
  look: { minPx: number; bright: number },
  name: string,
): Points {
  const own = {
    uHalfHeight: { value: 1 },
    uRatio: { value: 1 },
    uMinPx: { value: look.minPx },
    uBright: { value: look.bright },
  };
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, ...own },
    vertexShader,
    fragmentShader: LIGHT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false; // the shader or the frame places them: no bounding sphere to trust
  points.name = name;
  // The pixel size follows the canvas: its drawing height and the device's pixel ratio.
  const buffer = new Vector2();
  points.onBeforeRender = (renderer) => {
    own.uHalfHeight.value = renderer.getDrawingBufferSize(buffer).y / 2;
    own.uRatio.value = renderer.getPixelRatio();
  };
  return points;
}

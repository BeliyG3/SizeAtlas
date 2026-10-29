import type { Traffic } from "./traffic";

/**
 * Traffic that stands still: cars at (x, 0, z) heading `heading` (default +z), all live and grown
 * in; `air` lists the flying ones. For tests.
 */
export function standingCars(
  at: readonly (readonly [number, number, number?])[],
  air: readonly number[] = [],
): Traffic {
  return {
    count: at.length,
    x: Float32Array.from(at, ([x]) => x),
    y: new Float32Array(at.length),
    z: Float32Array.from(at, ([, z]) => z),
    heading: Float32Array.from(at, ([, , h]) => h ?? 0),
    air: Uint8Array.from(at, (_, i) => (air.includes(i) ? 1 : 0)),
    appear: new Float32Array(at.length).fill(1),
    live: new Uint8Array(at.length).fill(1),
    update: () => {},
  };
}

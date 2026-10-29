/**
 * Movers drawn between two fixed steps: each eased from where the step before left it to where
 * the last one did, as the player is; pure, nothing is allocated in a frame.
 */

/** A mover farther than this from where it was a step before was put down anew: drawn there, metres. */
export const JUMP = 10;

interface Moving {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
}

const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * `keep` before each step; `at(alpha)` is `src` drawn `alpha` of the way past the step before:
 * a copy with its own positions and headings, the rest shared with `src`.
 */
export function createBetween<T extends Moving>(src: T) {
  const n = src.x.length;
  const was = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
  };
  const shown: T = {
    ...src,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
  };
  const keep = () => {
    was.x.set(src.x);
    was.y.set(src.y);
    was.z.set(src.z);
    was.heading.set(src.heading);
  };
  keep();
  return {
    keep,
    at(alpha: number): T {
      for (let i = 0; i < n; i++) {
        const dx = src.x[i] - was.x[i];
        const dz = src.z[i] - was.z[i];
        const k = dx * dx + dz * dz > JUMP * JUMP ? 1 : alpha;
        shown.x[i] = was.x[i] + dx * k;
        shown.y[i] = was.y[i] + (src.y[i] - was.y[i]) * k;
        shown.z[i] = was.z[i] + dz * k;
        shown.heading[i] = was.heading[i] + wrap(src.heading[i] - was.heading[i]) * k;
      }
      return shown;
    },
  };
}

/** The game's clock: physics in fixed steps of 60 Hz, drawing in between at the display's rate. */

/** One physics step, seconds. */
export const FIXED = 1 / 60;
/** The longest frame the physics catches up on, seconds: a stall never makes a jump. */
export const MAX_FRAME = 0.1;

/** A frame's time, seconds: never negative, never past `MAX_FRAME`. */
export const clampFrame = (dt: number) => Math.min(Math.max(dt, 0), MAX_FRAME);

/**
 * Adds the frame's `dt` (clamped to `MAX_FRAME`) to the time left over, `acc`: the fixed steps to
 * run, what is left after them, and how far (0..1) the drawn frame lies past the last step.
 */
export function stepsFor(acc: number, dt: number): { steps: number; acc: number; alpha: number } {
  const total = acc + clampFrame(dt);
  // A hair of slack, so 0.1 s is 6 steps and not 5 and a rounding error.
  const steps = Math.floor(total / FIXED + 1e-6);
  const left = Math.max(0, total - steps * FIXED);
  return { steps, acc: left, alpha: Math.min(1, left / FIXED) };
}

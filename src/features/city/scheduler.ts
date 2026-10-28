/**
 * Render on demand: one frame per burst of changes, a frame per step while flying.
 * An optional animation adds frames at a capped rate, and only while the canvas shows.
 */

export interface Clock {
  raf: (cb: (now: number) => void) => number;
  caf: (id: number) => void;
  hidden: () => boolean;
  /** Milliseconds, the same timeline as the `raf` timestamps. */
  now: () => number;
}

const browserClock: Clock = {
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  hidden: () => document.hidden,
  now: () => performance.now(),
};

/** Longest step handed to an animation, so a stall never makes a jump. */
const MAX_DT = 0.1;
/** A display frame may land this early (ms) and still count as the next animation frame. */
const RATE_SLACK_MS = 1;

export interface Scheduler {
  /** Something on screen changed: draw it in the next frame (or once shown again). */
  invalidate: () => void;
  /** Call on `visibilitychange`: hiding cancels a flight, showing draws what changed meanwhile. */
  visibility: () => void;
  /** Call when the canvas enters or leaves the visible part of the window. */
  setVisible: (visible: boolean) => void;
  /** Calls `step(k)` with k going 0 → 1 over `ms`, drawing after each step. */
  fly: (step: (k: number) => void, ms: number) => void;
  stopFly: () => void;
  /**
   * While `step` is set, runs `step(dt)` (seconds, at most 0.1) and draws, at most `fps` times a
   * second and only while shown. `null` turns it off and leaves render on demand.
   */
  animate: (step: ((dt: number) => void) | null, fps: number) => void;
  dispose: () => void;
}

export function createScheduler(draw: () => void, clock: Clock = browserClock): Scheduler {
  let frame = 0;
  let dirty = false;
  let disposed = false;
  let visible = true;
  let flight: { step: (k: number) => void; ms: number; start: number | null } | null = null;
  let anim: { step: (dt: number) => void; interval: number } | null = null;
  /** Time of the last animation step; null while stopped so a resume starts a fresh clock. */
  let animLast: number | null = null;

  const blocked = () => clock.hidden() || !visible;
  const request = () => {
    if (!frame && !disposed && !blocked()) frame = clock.raf(tick);
  };
  const resume = () => {
    if (blocked()) return;
    if (anim) animLast ??= clock.now();
    if (dirty || flight || anim) request();
  };

  function tick(now: number) {
    // `frame` stays set while drawing, so a change made by the step or the draw joins this frame.
    if (blocked()) {
      // Whatever this frame was for is lost; `visibility`/`setVisible` bring it back.
      dirty = true;
      flight = null;
      animLast = null;
      frame = 0;
      return;
    }
    let due = dirty;
    if (flight) {
      flight.start ??= now;
      const k = Math.min(1, (now - flight.start) / flight.ms);
      flight.step(k);
      if (k >= 1) flight = null;
      due = true;
    }
    if (anim) {
      const t = clock.now();
      animLast ??= t;
      if (t - animLast >= anim.interval - RATE_SLACK_MS) {
        const dt = Math.min(MAX_DT, (t - animLast) / 1000);
        animLast = t;
        anim.step(dt);
        due = true;
      }
    }
    if (due) draw();
    dirty = false;
    frame = 0;
    if (flight || anim) request();
  }

  return {
    invalidate() {
      dirty = true;
      request();
    },
    visibility() {
      if (clock.hidden()) {
        flight = null;
        animLast = null;
      } else resume();
    },
    setVisible(next) {
      visible = next;
      if (next) {
        resume();
        return;
      }
      flight = null;
      animLast = null;
      if (frame) clock.caf(frame);
      frame = 0;
    },
    fly(step, ms) {
      flight = { step, ms, start: null };
      request();
    },
    stopFly() {
      flight = null;
    },
    animate(step, fps) {
      anim = step ? { step, interval: 1000 / fps } : null;
      animLast = anim && !blocked() ? clock.now() : null;
      if (anim) request();
    },
    dispose() {
      disposed = true;
      flight = null;
      anim = null;
      if (frame) clock.caf(frame);
      frame = 0;
    },
  };
}

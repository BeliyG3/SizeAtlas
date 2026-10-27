/** Render on demand: one frame per burst of changes, a frame per step only while flying. */

export interface Clock {
  raf: (cb: (now: number) => void) => number;
  caf: (id: number) => void;
  hidden: () => boolean;
}

const browserClock: Clock = {
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  hidden: () => document.hidden,
};

export interface Scheduler {
  /** Something on screen changed: draw it in the next frame (or once shown again). */
  invalidate: () => void;
  /** Call on `visibilitychange`: hiding cancels a flight, showing draws what changed meanwhile. */
  visibility: () => void;
  /** Calls `step(k)` with k going 0 → 1 over `ms`, drawing after each step. */
  fly: (step: (k: number) => void, ms: number) => void;
  stopFly: () => void;
  dispose: () => void;
}

export function createScheduler(draw: () => void, clock: Clock = browserClock): Scheduler {
  let frame = 0;
  let dirty = false;
  let disposed = false;
  let flight: { step: (k: number) => void; ms: number; start: number | null } | null = null;

  const request = () => {
    if (!frame && !disposed) frame = clock.raf(tick);
  };
  function tick(now: number) {
    // `frame` stays set while drawing, so a change made by the step or the draw joins this frame.
    if (clock.hidden()) {
      dirty = true;
    } else {
      if (flight) {
        flight.start ??= now;
        const k = Math.min(1, (now - flight.start) / flight.ms);
        flight.step(k);
        if (k >= 1) flight = null;
      }
      dirty = false;
      draw();
    }
    frame = 0;
    if (flight) request();
  }

  return {
    invalidate() {
      if (clock.hidden()) dirty = true;
      else request();
    },
    visibility() {
      if (clock.hidden()) flight = null;
      else if (dirty) request();
    },
    fly(step, ms) {
      flight = { step, ms, start: null };
      request();
    },
    stopFly() {
      flight = null;
    },
    dispose() {
      disposed = true;
      flight = null;
      if (frame) clock.caf(frame);
      frame = 0;
    },
  };
}

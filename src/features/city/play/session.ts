/**
 * The play session: full screen on the way in and always off on the way out, a pause while the
 * window is away, and the fixed-step clock, started anew by every resume.
 *
 * idle → entering → playing ⇄ paused → leaving → idle
 */
import { clampFrame, stepsFor } from "./loop";

export type PlayState = "idle" | "entering" | "playing" | "paused" | "leaving";

export interface SessionDeps {
  setFullscreen(on: boolean): Promise<void>;
}

export interface Frame {
  /** Fixed physics steps to run this frame. */
  steps: number;
  /** Where the drawn frame lies past the last step, 0..1. */
  alpha: number;
  /** The frame's time, seconds, clamped as the steps are. */
  dt: number;
}

export interface Session {
  readonly state: PlayState;
  /** Goes full screen; true once playing. On a failure the window is put back and the session idles. */
  enter(): Promise<boolean>;
  /** The window lost focus or was hidden. */
  pause(): void;
  /** Back from a pause with the clock started anew: no catching up on the time away. */
  resume(): void;
  /** Leaves full screen, even after an error, and ends idle. */
  leave(): Promise<void>;
  /** The frame at `now` (ms, the requestAnimationFrame timeline). No steps unless playing. */
  frame(now: number): Frame;
}

export function createSession(deps: SessionDeps): Session {
  let state: PlayState = "idle";
  let acc = 0;
  let last: number | null = null;
  // The full screen change in flight: leaving waits for it, so it never lands after ours.
  let pending: Promise<unknown> = Promise.resolve();
  let leaving: Promise<void> | null = null;
  const out: Frame = { steps: 0, alpha: 0, dt: 0 };

  const restart = () => {
    acc = 0;
    last = null;
  };
  const windowed = async () => {
    try {
      await deps.setFullscreen(false);
    } catch {
      // Nothing more to try: the window keeps what it has.
    }
  };

  return {
    get state() {
      return state;
    },
    async enter() {
      if (state !== "idle") return false;
      state = "entering";
      const on = (async () => deps.setFullscreen(true))();
      pending = on.catch(() => undefined);
      try {
        await on;
      } catch {
        // Half way there or not at all: back to a window either way, unless leaving does that.
        if (state === "entering") {
          await windowed();
          state = "idle";
        }
        return false;
      }
      if (state !== "entering") return false;
      restart();
      state = "playing";
      return true;
    },
    pause() {
      if (state === "playing") state = "paused";
    },
    resume() {
      if (state !== "paused") return;
      restart();
      state = "playing";
    },
    leave() {
      if (leaving) return leaving;
      if (state === "idle") return Promise.resolve();
      state = "leaving";
      leaving = (async () => {
        await pending;
        await windowed();
        state = "idle";
        leaving = null;
      })();
      return leaving;
    },
    frame(now) {
      out.steps = 0;
      out.dt = 0;
      if (state !== "playing") return out;
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const r = stepsFor(acc, dt);
      acc = r.acc;
      out.steps = r.steps;
      out.alpha = r.alpha;
      out.dt = clampFrame(dt);
      return out;
    },
  };
}

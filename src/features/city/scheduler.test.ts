import { describe, expect, it, vi } from "vitest";
import { createScheduler, type Clock } from "./scheduler";

/** A clock whose frames run only when the test says so. */
function fakeClock() {
  let next = 1;
  const frames = new Map<number, (now: number) => void>();
  const clock = {
    hidden: false,
    raf: (cb: (now: number) => void) => {
      frames.set(next, cb);
      return next++;
    },
    caf: (id: number) => void frames.delete(id),
    isHidden: () => clock.hidden,
    /** Runs the frames requested so far at time `now`. */
    tick(now: number) {
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    },
    pending: () => frames.size,
  };
  const asClock: Clock = { raf: clock.raf, caf: clock.caf, hidden: clock.isHidden };
  return { clock, asClock };
}

describe("createScheduler", () => {
  it("draws one frame for two invalidations", () => {
    const { clock, asClock } = fakeClock();
    const draw = vi.fn();
    const s = createScheduler(draw, asClock);
    s.invalidate();
    s.invalidate();
    expect(clock.pending()).toBe(1);
    clock.tick(0);
    expect(draw).toHaveBeenCalledTimes(1);
    clock.tick(16);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("an invalidation while drawing is covered by that frame", () => {
    const { clock, asClock } = fakeClock();
    const s = createScheduler(() => s.invalidate(), asClock);
    s.invalidate();
    clock.tick(0);
    expect(clock.pending()).toBe(0);
  });

  it("keeps a change made while hidden and draws it once when shown again", () => {
    const { clock, asClock } = fakeClock();
    const draw = vi.fn();
    const s = createScheduler(draw, asClock);
    clock.hidden = true;
    s.invalidate();
    s.invalidate();
    clock.tick(0);
    expect(draw).not.toHaveBeenCalled();
    clock.hidden = false;
    s.visibility();
    s.visibility();
    clock.tick(16);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when shown again with nothing changed", () => {
    const { clock, asClock } = fakeClock();
    const draw = vi.fn();
    const s = createScheduler(draw, asClock);
    clock.hidden = true;
    s.visibility();
    clock.hidden = false;
    s.visibility();
    clock.tick(0);
    expect(draw).not.toHaveBeenCalled();
  });

  it("a fly-to draws every frame until its end, then stops", () => {
    const { clock, asClock } = fakeClock();
    const draw = vi.fn();
    const step = vi.fn();
    const s = createScheduler(draw, asClock);
    s.fly(step, 400);
    for (const now of [1000, 1200, 1400, 1600]) clock.tick(now);
    expect(step.mock.calls.map(([k]) => k)).toEqual([0, 0.5, 1]);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(clock.pending()).toBe(0);
  });

  it("a cancelled fly-to stops where it is; hiding the window cancels it too", () => {
    const { clock, asClock } = fakeClock();
    const step = vi.fn();
    const s = createScheduler(vi.fn(), asClock);
    s.fly(step, 400);
    clock.tick(0);
    s.stopFly();
    clock.tick(100);
    expect(step).toHaveBeenCalledTimes(1);
    s.fly(step, 400);
    clock.hidden = true;
    s.visibility();
    clock.hidden = false;
    clock.tick(200);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels the pending frame", () => {
    const { clock, asClock } = fakeClock();
    const draw = vi.fn();
    const s = createScheduler(draw, asClock);
    s.invalidate();
    s.dispose();
    clock.tick(0);
    s.invalidate();
    clock.tick(16);
    expect(draw).not.toHaveBeenCalled();
  });
});

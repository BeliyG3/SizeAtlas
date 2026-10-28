import { describe, expect, it, vi } from "vitest";
import { createScheduler, type Clock } from "./scheduler";

/** A clock whose frames run only when the test says so. */
function fakeClock() {
  let next = 1;
  let time = 0;
  const frames = new Map<number, (now: number) => void>();
  const clock = {
    hidden: false,
    raf: (cb: (now: number) => void) => {
      frames.set(next, cb);
      return next++;
    },
    caf: (id: number) => void frames.delete(id),
    isHidden: () => clock.hidden,
    now: () => time,
    /** Runs the frames requested so far at time `now`. */
    tick(now: number) {
      time = now;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    },
    pending: () => frames.size,
  };
  const asClock: Clock = { raf: clock.raf, caf: clock.caf, hidden: clock.isHidden, now: clock.now };
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

  describe("animation", () => {
    type FakeClock = ReturnType<typeof fakeClock>["clock"];
    /** Runs a 60 Hz display from `from` for `ms`. */
    function run(clock: FakeClock, from: number, ms: number) {
      for (let t = from; t <= from + ms; t += 1000 / 60) clock.tick(t);
    }

    it("animates at no more than the given rate", () => {
      const { clock, asClock } = fakeClock();
      const draw = vi.fn();
      const step = vi.fn();
      const s = createScheduler(draw, asClock);
      s.animate(step, 30);
      run(clock, 16.7, 1000);
      expect(draw.mock.calls.length).toBeGreaterThanOrEqual(29);
      expect(draw.mock.calls.length).toBeLessThanOrEqual(31);
      expect(step).toHaveBeenCalledTimes(draw.mock.calls.length);
      for (const [dt] of step.mock.calls) expect(dt).toBeLessThanOrEqual(0.1);
    });

    it("steps before it draws", () => {
      const { clock, asClock } = fakeClock();
      const order: string[] = [];
      const s = createScheduler(() => order.push("draw"), asClock);
      s.animate(() => order.push("step"), 30);
      run(clock, 0, 100);
      expect(order.slice(0, 2)).toEqual(["step", "draw"]);
    });

    it("draws nothing while hidden or off screen, and resumes without a jump", () => {
      const { clock, asClock } = fakeClock();
      const draw = vi.fn();
      const step = vi.fn();
      const s = createScheduler(draw, asClock);
      s.animate(step, 30);
      run(clock, 0, 200);
      s.setVisible(false);
      expect(clock.pending()).toBe(0);
      const before = draw.mock.calls.length;
      run(clock, 300, 5000);
      expect(draw.mock.calls.length).toBe(before);
      s.setVisible(true);
      step.mockClear();
      run(clock, 6000, 200);
      expect(step).toHaveBeenCalled();
      for (const [dt] of step.mock.calls) expect(dt).toBeLessThanOrEqual(0.1);

      clock.hidden = true;
      run(clock, 7000, 100);
      expect(clock.pending()).toBe(0);
      const hiddenCount = draw.mock.calls.length;
      run(clock, 7100, 1000);
      expect(draw.mock.calls.length).toBe(hiddenCount);
      clock.hidden = false;
      step.mockClear();
      s.visibility();
      run(clock, 12000, 200);
      expect(step).toHaveBeenCalled();
      for (const [dt] of step.mock.calls) expect(dt).toBeLessThanOrEqual(0.1);
    });

    it("caps dt when frames arrive late", () => {
      const { clock, asClock } = fakeClock();
      const step = vi.fn();
      const s = createScheduler(vi.fn(), asClock);
      s.animate(step, 30);
      clock.tick(0);
      clock.tick(2000);
      expect(step).toHaveBeenLastCalledWith(0.1);
    });

    it("stopping the animation leaves render on demand", () => {
      const { clock, asClock } = fakeClock();
      const draw = vi.fn();
      const s = createScheduler(draw, asClock);
      s.animate(vi.fn(), 30);
      run(clock, 0, 100);
      s.animate(null, 30);
      clock.tick(200);
      expect(clock.pending()).toBe(0);
      const count = draw.mock.calls.length;
      s.invalidate();
      clock.tick(216);
      expect(draw).toHaveBeenCalledTimes(count + 1);
      expect(clock.pending()).toBe(0);
    });

    it("an invalidation or a flight during the animation never draws twice in a frame", () => {
      const { clock, asClock } = fakeClock();
      const draw = vi.fn();
      const s = createScheduler(draw, asClock);
      s.animate(vi.fn(), 60);
      clock.tick(0);
      clock.tick(16.7);
      draw.mockClear();
      s.invalidate();
      s.fly(vi.fn(), 100);
      expect(clock.pending()).toBe(1);
      clock.tick(33.4);
      expect(draw).toHaveBeenCalledTimes(1);
    });

    it("an invalidation between animation steps draws at once", () => {
      const { clock, asClock } = fakeClock();
      const draw = vi.fn();
      const s = createScheduler(draw, asClock);
      s.animate(vi.fn(), 30);
      clock.tick(0);
      clock.tick(16.7);
      draw.mockClear();
      s.invalidate();
      clock.tick(33.4);
      expect(draw).toHaveBeenCalledTimes(1);
    });
  });
});

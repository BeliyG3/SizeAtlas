import { describe, expect, it, vi } from "vitest";
import { createSession } from "./session";

const fullscreen = () => vi.fn((on: boolean) => Promise.resolve(void on));

describe("the play session", () => {
  it("goes full screen on the way in and plays", async () => {
    const setFullscreen = fullscreen();
    const s = createSession({ setFullscreen });
    const entering = s.enter();
    expect(s.state).toBe("entering");
    expect(await entering).toBe(true);
    expect(setFullscreen.mock.calls).toEqual([[true]]);
    expect(s.state).toBe("playing");
  });

  it("pauses and resumes, and leaves full screen from a pause", async () => {
    const setFullscreen = fullscreen();
    const s = createSession({ setFullscreen });
    await s.enter();
    s.pause();
    expect(s.state).toBe("paused");
    s.resume();
    expect(s.state).toBe("playing");
    s.pause();
    const leaving = s.leave();
    expect(s.state).toBe("leaving");
    await leaving;
    expect(setFullscreen.mock.calls).toEqual([[true], [false]]);
    expect(s.state).toBe("idle");
  });

  it("puts the window back and idles when full screen fails", async () => {
    const setFullscreen = vi.fn((on: boolean) =>
      on ? Promise.reject(new Error("refused")) : Promise.resolve(),
    );
    const s = createSession({ setFullscreen });
    expect(await s.enter()).toBe(false);
    expect(s.state).toBe("idle");
    expect(setFullscreen.mock.calls).toEqual([[true], [false]]);
  });

  it("ends idle even when leaving full screen fails", async () => {
    const setFullscreen = vi.fn((on: boolean) =>
      on ? Promise.resolve() : Promise.reject(new Error("stuck")),
    );
    const s = createSession({ setFullscreen });
    await s.enter();
    await s.leave();
    expect(s.state).toBe("idle");
  });

  it("leaving while entering waits for full screen, then turns it off", async () => {
    let done = () => {};
    const setFullscreen = vi.fn((on: boolean) =>
      on ? new Promise<void>((r) => (done = r)) : Promise.resolve(),
    );
    const s = createSession({ setFullscreen });
    const entering = s.enter();
    const leaving = s.leave();
    done();
    expect(await entering).toBe(false);
    await leaving;
    expect(setFullscreen.mock.calls).toEqual([[true], [false]]);
    expect(s.state).toBe("idle");
  });

  it("runs no steps unless playing", async () => {
    const s = createSession({ setFullscreen: fullscreen() });
    expect(s.frame(0).steps).toBe(0);
    await s.enter();
    s.frame(0);
    expect(s.frame(1000 / 30).steps).toBe(2);
    s.pause();
    expect(s.frame(5000).steps).toBe(0);
  });

  it("does not catch up on the time away after a resume", async () => {
    const s = createSession({ setFullscreen: fullscreen() });
    await s.enter();
    s.frame(0);
    s.frame(16);
    s.pause();
    s.resume();
    // Ten seconds behind (Alt+Tab, a minimised window): the first frame back is a short one.
    expect(s.frame(10_000).steps).toBeLessThanOrEqual(1);
    expect(s.frame(10_000 + 1000 / 144).steps).toBeLessThanOrEqual(1);
  });
});

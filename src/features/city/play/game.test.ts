import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitySnapshot } from "../scene";
import { startGame } from "./game";
import type { Input } from "./input";
import { fakeDom } from "./input.fixture";

const setFullscreen = vi.hoisted(() =>
  vi.fn((on: boolean): Promise<void> => Promise.resolve(void on)),
);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFullscreen }) }));

const scene = vi.hoisted(() => ({
  frame: vi.fn(),
  step: vi.fn(),
  draw: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./playScene", () => ({ createPlayScene: () => scene }));

// The real input, with its reset watched.
const inputs = vi.hoisted(() => [] as Input[]);
vi.mock("./input", async (original) => {
  const real = await original<typeof import("./input")>();
  return {
    ...real,
    createInput: (target: HTMLElement) => {
      const input = real.createInput(target);
      vi.spyOn(input, "reset");
      inputs.push(input);
      return input;
    },
  };
});

const city = {} as CitySnapshot;
let dom: ReturnType<typeof fakeDom>;
let frames: Map<number, FrameRequestCallback>;

/** Runs the frames asked for so far, at `now` ms. */
const tick = (now: number) => {
  const due = [...frames.values()];
  frames.clear();
  for (const f of due) f(now);
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const fullscreenCalls = () => setFullscreen.mock.calls.map(([on]) => on);

async function playing() {
  const onExit = vi.fn();
  const stop = startGame(dom.canvas as HTMLCanvasElement, city, onExit);
  await settle();
  tick(0);
  return { onExit, stop };
}

beforeEach(() => {
  vi.clearAllMocks();
  inputs.length = 0;
  dom = fakeDom();
  frames = new Map();
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.set(next, f);
    return next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the game", () => {
  it("goes full screen and draws a frame a display frame", async () => {
    await playing();
    expect(fullscreenCalls()).toEqual([true]);
    tick(16);
    expect(scene.draw).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);
  });

  it("Esc leaves full screen once and exits once", async () => {
    const { onExit } = await playing();
    dom.key("keydown", "Escape");
    tick(16);
    await settle();
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    // Nothing runs any more: another Esc does nothing.
    expect(frames.size).toBe(0);
    dom.key("keyup", "Escape");
    dom.key("keydown", "Escape");
    tick(32);
    await settle();
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("stops the frames while the window is away", async () => {
    await playing();
    dom.doc.focused = false;
    dom.win.dispatchEvent(new Event("blur"));
    expect(frames.size).toBe(0);
    const drawn = scene.draw.mock.calls.length;
    tick(5000);
    expect(scene.draw).toHaveBeenCalledTimes(drawn);
  });

  it("comes back with the input reset and no catching up", async () => {
    await playing();
    tick(16);
    dom.doc.focused = false;
    dom.win.dispatchEvent(new Event("blur"));
    dom.doc.focused = true;
    dom.win.dispatchEvent(new Event("focus"));
    expect(inputs[0].reset).toHaveBeenCalled();
    scene.step.mockClear();
    // Ten seconds away: the first frame back is a short one, the next a normal one.
    tick(10_000);
    expect(scene.step.mock.calls.length).toBeLessThanOrEqual(1);
    const first = scene.step.mock.calls.length;
    tick(10_000 + 1000 / 30);
    expect(scene.step.mock.calls.length - first).toBe(2);
  });

  it("starts paused when the window is already away", async () => {
    dom.doc.focused = false;
    startGame(dom.canvas as HTMLCanvasElement, city, vi.fn());
    await settle();
    expect(frames.size).toBe(0);
    dom.doc.focused = true;
    dom.win.dispatchEvent(new Event("focus"));
    expect(frames.size).toBe(1);
  });

  it("a hidden window pauses too, and showing it again resumes", async () => {
    await playing();
    dom.doc.hidden = true;
    dom.doc.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    dom.doc.hidden = false;
    dom.doc.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
  });

  it("an unmount leaves full screen without calling onExit", async () => {
    const { onExit, stop } = await playing();
    await stop();
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("a page going away puts the window back at once", async () => {
    await playing();
    dom.win.dispatchEvent(new Event("pagehide"));
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(frames.size).toBe(0);
  });

  it("says so when the window cannot leave full screen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setFullscreen.mockImplementation((on) =>
      on ? Promise.resolve() : Promise.reject(new Error("stuck")),
    );
    const { onExit } = await playing();
    dom.key("keydown", "Escape");
    tick(16);
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    setFullscreen.mockImplementation((on) => Promise.resolve(void on));
    warn.mockRestore();
  });

  it("exits without playing when full screen is refused", async () => {
    setFullscreen.mockImplementationOnce(() => Promise.reject(new Error("refused")));
    const onExit = vi.fn();
    startGame(dom.canvas as HTMLCanvasElement, city, onExit);
    await settle();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(frames.size).toBe(0);
  });
});

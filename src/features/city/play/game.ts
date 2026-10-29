/**
 * Play mode at run time: the session, the input and the game scene on one requestAnimationFrame
 * loop at the display's rate (vsync, no cap), physics in fixed steps. Paused while the window is
 * away; Esc leaves.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CitySnapshot } from "../scene";
import { createInput, type Input } from "./input";
import { FIXED } from "./loop";
import { createPlayScene, type PlayScene } from "./playScene";
import { createSession } from "./session";

const away = () => document.hidden || !document.hasFocus();

/**
 * Starts the game on `canvas`. `onExit` runs once the window is back from full screen: after Esc,
 * or when the game could not start. Returns the stop function, for an unmount.
 */
export function startGame(
  canvas: HTMLCanvasElement,
  city: CitySnapshot,
  background: string,
  onExit: () => void,
): () => void {
  const session = createSession({
    setFullscreen: async (on) => getCurrentWindow().setFullscreen(on),
  });
  let scene: PlayScene;
  try {
    scene = createPlayScene(canvas, city, background);
  } catch {
    queueMicrotask(onExit);
    return () => {};
  }
  const input: Input = createInput(canvas);
  let frame = 0;
  let stopped = false;

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const { steps, alpha, dt } = session.frame(now);
    const actions = input.read(dt);
    if (actions.exit) {
      leave();
      return;
    }
    scene.look(actions.look);
    for (let i = 0; i < steps; i++) scene.step(actions, FIXED);
    scene.draw(alpha, dt);
  };
  const run = () => {
    if (!frame && !stopped) frame = requestAnimationFrame(tick);
  };
  const halt = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const pause = () => {
    session.pause();
    halt();
  };
  const resume = () => {
    if (session.state !== "paused" || away()) return;
    session.resume();
    // What came in while away (a lock the window lost, keys) is not this game's.
    input.reset();
    run();
  };
  const onVisibility = () => (document.hidden ? pause() : resume());
  window.addEventListener("blur", pause);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", onVisibility);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    halt();
    window.removeEventListener("blur", pause);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", onVisibility);
    input.dispose();
    scene.dispose();
  };
  const leave = () => {
    stop();
    void session.leave().then(onExit);
  };

  void session.enter().then((playing) => {
    if (stopped) return;
    if (!playing) {
      stop();
      onExit();
      return;
    }
    if (away()) pause();
    else run();
  });

  return () => {
    stop();
    void session.leave();
  };
}

/**
 * Play mode at run time: the session, the input and the game scene on one requestAnimationFrame
 * loop at the display's rate (vsync, no cap), physics in fixed steps. Paused while the window is
 * away; Esc leaves.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CitySnapshot } from "../scene";
import { makeHud, sameHud, type HudState } from "./hints";
import { createInput } from "./input";
import { FIXED } from "./loop";
import { createPlayScene, type PlayScene } from "./playScene";
import { createSession } from "./session";

const away = () => document.hidden || !document.hasFocus();

async function setFullscreen(on: boolean) {
  try {
    await getCurrentWindow().setFullscreen(on);
  } catch (e) {
    // A window left in full screen is worth a trace; the session carries on either way.
    if (!on) console.warn("Could not leave full screen", e);
    throw e;
  }
}

/**
 * Starts the game on `canvas`. `onExit` runs once the window is back from full screen: after Esc,
 * or when the game could not start. `onHud` gets the HUD's state when it changes. Returns the stop function, for an unmount or a closed layer:
 * it leaves full screen and resolves once the window is back. `onExit` is not called by it.
 */
export function startGame(
  canvas: HTMLCanvasElement,
  city: CitySnapshot,
  onExit: () => void,
  onHud: (hud: HudState) => void = () => {},
): () => Promise<void> {
  const session = createSession({ setFullscreen });
  let scene: PlayScene;
  try {
    scene = createPlayScene(canvas, city);
  } catch {
    queueMicrotask(onExit);
    return () => Promise.resolve();
  }
  const input = createInput(canvas);
  let frame = 0;
  let stopped = false;

  // The HUD hears of a change only, not of every frame.
  const shown = makeHud();
  const publish = () => {
    const now = scene.hud();
    now.paused = session.state === "paused";
    if (sameHud(now, shown)) return;
    Object.assign(shown, now);
    onHud({ ...shown });
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const { steps, alpha, dt } = session.frame(now);
    const actions = input.read(dt);
    if (actions.exit) {
      leave();
      return;
    }
    scene.frame(actions);
    for (let i = 0; i < steps; i++) scene.step(actions, FIXED);
    scene.draw(alpha, dt);
    publish();
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
    publish();
  };
  const resume = () => {
    if (session.state !== "paused" || away()) return;
    session.resume();
    publish();
    // What came in while away (a lock the window lost, keys) is not this game's.
    input.reset();
    run();
  };
  const onVisibility = () => (document.hidden ? pause() : resume());
  // A reload or a closed window: put it back now, there is no later.
  const onPageHide = () => {
    stop();
    void setFullscreen(false).catch(() => undefined);
  };
  window.addEventListener("blur", pause);
  window.addEventListener("focus", resume);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    halt();
    window.removeEventListener("blur", pause);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pagehide", onPageHide);
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
    return session.leave();
  };
}

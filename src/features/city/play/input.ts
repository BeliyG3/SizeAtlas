/** Play-mode input: keys, mouse and gamepad folded into one set of actions per frame. */
import { createPadReader, PAD_A, PAD_B, PAD_START, type PadState } from "./pad";

export { PAD_A, PAD_B, PAD_START, type PadState };

/** What the player wants this frame. Axes are in -1..1; look is in radians for this frame. */
export interface Actions {
  /** On foot: x right, y forward. */
  move: { x: number; y: number };
  /** Camera turn: x right, y down. */
  look: { x: number; y: number };
  throttle: number;
  brake: number;
  /** Car steering, right is positive. */
  steer: number;
  /** Flight: climb and descend (held). */
  up: boolean;
  down: boolean;
  /** Edges: true for one frame only. */
  jump: boolean;
  /** Get in or out of a car (edge). */
  use: boolean;
  /** Take off or land (edge). */
  fly: boolean;
  /** Leave the game (edge). */
  exit: boolean;
  sprint: boolean;
}

export interface Input {
  /** Actions since the previous read; edges are consumed. The same object is reused. */
  read(dt: number): Actions;
  /**
   * Forgets presses, mouse moves and held pad buttons gathered so far. Already called on focus
   * loss; the session calls it when it resumes from a pause, since nothing is read while paused.
   */
  reset(): void;
  dispose(): void;
  /** Pointer lock is held. False after focus loss or dispose: the player clicks to look again. */
  readonly locked: boolean;
}

/** Radial stick dead zone. */
const DEAD = 0.15;
/** Trigger travel below this is noise. */
const TRIGGER_DEAD = 0.05;
/** Mouse look, radians per pixel. */
const MOUSE_X = 0.0035;
const MOUSE_Y = 0.003;
/** Pad look at full stick, radians per second. */
const PAD_LOOK_X = 2.8;
const PAD_LOOK_Y = 1.6;

export function makeActions(): Actions {
  return {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    throttle: 0,
    brake: 0,
    steer: 0,
    up: false,
    down: false,
    jump: false,
    use: false,
    fly: false,
    exit: false,
    sprint: false,
  };
}

const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
const held = (keys: ReadonlySet<string>, a: string, b: string) =>
  keys.has(a) || keys.has(b) ? 1 : 0;

/** Dead zone on the stick's length, rescaled so full tilt still gives 1. */
function dead(v: number, w: number): number {
  const m = Math.hypot(v, w);
  return m < DEAD ? 0 : (Math.min(1, (m - DEAD) / (1 - DEAD)) / m) * v;
}

/**
 * The pure core. `keys` are held `KeyboardEvent.code`s; `pressed` are the codes (and Pad* names)
 * that went down since the last frame. `mouse` is the pixel move since the last frame. A null pad
 * (never connected or just unplugged) contributes nothing. Writes into `out` and returns it;
 * with no `out` it makes a fresh object.
 */
export function actionsFrom(
  keys: ReadonlySet<string>,
  pressed: ReadonlySet<string>,
  mouse: { dx: number; dy: number },
  pad: PadState | null,
  dt = 1 / 60,
  out: Actions = makeActions(),
): Actions {
  const right = held(keys, "KeyD", "ArrowRight") - held(keys, "KeyA", "ArrowLeft");
  const fwd = held(keys, "KeyW", "ArrowUp") - held(keys, "KeyS", "ArrowDown");

  let px = 0;
  let py = 0;
  let lookX = mouse.dx * MOUSE_X;
  let lookY = mouse.dy * MOUSE_Y;
  let rt = 0;
  let lt = 0;
  if (pad) {
    px = dead(pad.lx, pad.ly);
    py = dead(pad.ly, pad.lx);
    lookX += dead(pad.rx, pad.ry) * PAD_LOOK_X * dt;
    lookY += dead(pad.ry, pad.rx) * PAD_LOOK_Y * dt;
    rt = pad.rt < TRIGGER_DEAD ? 0 : pad.rt;
    lt = pad.lt < TRIGGER_DEAD ? 0 : pad.lt;
  }

  let mx = clamp(right + px);
  let my = clamp(fwd - py);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  out.move.x = mx;
  out.move.y = my;
  out.look.x = lookX;
  out.look.y = lookY;
  out.throttle = Math.max(held(keys, "KeyW", "ArrowUp"), rt);
  out.brake = Math.max(held(keys, "KeyS", "ArrowDown"), lt);
  out.steer = clamp(right + px);
  out.up = keys.has("Space") || !!pad?.rb;
  out.down = keys.has("ShiftLeft") || keys.has("ShiftRight") || !!pad?.lb;
  out.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") || !!pad?.l3;
  out.jump = pressed.has("Space") || pressed.has(PAD_A);
  out.use = pressed.has("KeyE") || pressed.has(PAD_A);
  out.fly = pressed.has("KeyF") || pressed.has(PAD_B);
  out.exit = pressed.has("Escape") || pressed.has(PAD_START);
  return out;
}

/** Keys the page must not scroll or act on while playing. */
const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * Listens on `target` (the game canvas) and the document. Esc is handled here: under pointer lock
 * the browser may swallow it and just drop the lock, so a lock lost without our own release also
 * counts as Esc, unless the window lost focus (Alt+Tab drops the lock too, and that is a pause).
 * Without pointer lock the mouse looks around while a button is dragged.
 * Nothing allocates per frame except the browser's own `getGamepads()`.
 */
export function createInput(target: HTMLElement): Input {
  const keys = new Set<string>();
  const pressed = new Set<string>();
  const mouse = { dx: 0, dy: 0 };
  const pad: PadState = {
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    rt: 0,
    lt: 0,
    rb: false,
    lb: false,
    l3: false,
  };
  const pads = createPadReader();
  const out = makeActions();
  let locked = false;
  let dragging = false;
  let releasing = false;
  let blurred = false;

  const reset = () => {
    pressed.clear();
    mouse.dx = 0;
    mouse.dy = 0;
    pads.reset();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    blurred = false;
    // Esc always counts: a lost keyup must not block the next one.
    if (e.code === "Escape" || !keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (e.code === "Escape" && locked) {
      // Our own release, so the lock change below is not counted as a second exit.
      releasing = true;
      document.exitPointerLock?.();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => void keys.delete(e.code);
  const onBlur = () => {
    blurred = true;
    keys.clear();
    dragging = false;
    reset();
  };
  const onFocus = () => {
    blurred = false;
  };
  const onHidden = () => {
    if (document.hidden) onBlur();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!locked && !dragging) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    try {
      // Newer browsers return a promise that rejects when the lock is refused; dragging then stands in.
      void (target.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => undefined);
    } catch {
      // No pointer lock here: dragging stands in.
    }
  };
  const onUp = () => {
    dragging = false;
  };
  const onLockChange = () => {
    const now = document.pointerLockElement === target;
    const away = blurred || document.hidden || document.hasFocus?.() === false;
    if (locked && !now && !releasing && !away) pressed.add("Escape");
    releasing = false;
    locked = now;
  };

  const docEvents: [string, EventListener][] = [
    ["keydown", onKeyDown as EventListener],
    ["keyup", onKeyUp as EventListener],
    ["mousemove", onMouseMove as EventListener],
    ["pointerlockchange", onLockChange],
    ["visibilitychange", onHidden],
  ];
  const winEvents: [string, EventListener][] = [
    ["pointerup", onUp],
    ["pointercancel", onUp],
    ["blur", onBlur],
    ["focus", onFocus],
  ];
  for (const [t, f] of docEvents) document.addEventListener(t, f);
  for (const [t, f] of winEvents) window.addEventListener(t, f);
  target.addEventListener("pointerdown", onDown as EventListener);
  target.addEventListener("lostpointercapture", onUp);

  return {
    read(dt) {
      const p = pads.read(pad, pressed);
      actionsFrom(keys, pressed, mouse, p, dt, out);
      pressed.clear();
      mouse.dx = 0;
      mouse.dy = 0;
      return out;
    },
    reset,
    dispose() {
      for (const [t, f] of docEvents) document.removeEventListener(t, f);
      for (const [t, f] of winEvents) window.removeEventListener(t, f);
      target.removeEventListener("pointerdown", onDown as EventListener);
      target.removeEventListener("lostpointercapture", onUp);
      if (locked) document.exitPointerLock?.();
      locked = false;
      dragging = false;
    },
    get locked() {
      return locked;
    },
  };
}

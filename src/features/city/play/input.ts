/** Play-mode input: keys, mouse and gamepad folded into one set of actions per frame. */

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

/** A connected pad in the standard layout: sticks (y down is positive), triggers 0..1, held buttons. */
export interface PadState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  rt: number;
  lt: number;
  rb: boolean;
  lb: boolean;
  /** Left stick click. */
  l3: boolean;
}

export interface Input {
  /** Actions since the previous read; edges are consumed. The same object is reused. */
  read(dt: number): Actions;
  dispose(): void;
  readonly locked: boolean;
}

/** Radial stick dead zone. */
const DEAD = 0.15;
/** Mouse look, radians per pixel. */
const MOUSE_X = 0.0035;
const MOUSE_Y = 0.003;
/** Pad look at full stick, radians per second. */
const PAD_LOOK_X = 2.8;
const PAD_LOOK_Y = 1.6;

/** Names the pad's edges take in the `pressed` set. */
export const PAD_A = "PadA";
export const PAD_B = "PadB";
export const PAD_START = "PadStart";

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

/** Dead zone on the stick's length, rescaled so full tilt still gives 1. */
function dead(v: number, w: number): number {
  const m = Math.hypot(v, w);
  return m < DEAD ? 0 : (Math.min(1, (m - DEAD) / (1 - DEAD)) / m) * v;
}

/**
 * The pure core. `keys` are held `KeyboardEvent.code`s; `pressed` are the codes (and Pad* names)
 * that went down since the last frame. `mouse` is the pixel move since the last frame. A null pad
 * (never connected or just unplugged) contributes nothing. Writes into `out` and returns it.
 */
export function actionsFrom(
  keys: ReadonlySet<string>,
  pressed: ReadonlySet<string>,
  mouse: { dx: number; dy: number },
  pad: PadState | null,
  dt = 1 / 60,
  out: Actions = makeActions(),
): Actions {
  const held = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0);
  const right = held("KeyD", "ArrowRight") - held("KeyA", "ArrowLeft");
  const fwd = held("KeyW", "ArrowUp") - held("KeyS", "ArrowDown");

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
    rt = pad.rt;
    lt = pad.lt;
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
  out.throttle = Math.max(held("KeyW", "ArrowUp"), rt);
  out.brake = Math.max(held("KeyS", "ArrowDown"), lt);
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

interface Face {
  a: boolean;
  b: boolean;
  start: boolean;
}

/** Reads the first connected pad into `out` and `face`, or returns null. Standard layout indices. */
function readPad(out: PadState, face: Face): PadState | null {
  const pads = navigator.getGamepads?.();
  if (!pads) return null;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p || !p.connected) continue;
    const b = p.buttons;
    out.lx = p.axes[0] ?? 0;
    out.ly = p.axes[1] ?? 0;
    out.rx = p.axes[2] ?? 0;
    out.ry = p.axes[3] ?? 0;
    out.lt = b[6]?.value ?? 0;
    out.rt = b[7]?.value ?? 0;
    out.lb = !!b[4]?.pressed;
    out.rb = !!b[5]?.pressed;
    out.l3 = !!b[10]?.pressed;
    face.a = !!b[0]?.pressed;
    face.b = !!b[1]?.pressed;
    face.start = !!b[9]?.pressed;
    return out;
  }
  return null;
}

/**
 * Listens on `target` (the game canvas) and the document. Esc is handled here: under pointer lock
 * the browser may swallow it and just drop the lock, so a lock lost without our own release also
 * counts as Esc. Without pointer lock the mouse looks around while a button is dragged.
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
  const face: Face = { a: false, b: false, start: false };
  const prev: Face = { a: false, b: false, start: false };
  const out = makeActions();
  let locked = false;
  let dragging = false;
  let releasing = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (e.code === "Escape" && locked) {
      // Our own release, so the lock change below is not counted as a second exit.
      releasing = true;
      document.exitPointerLock?.();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => void keys.delete(e.code);
  const onBlur = () => {
    keys.clear();
    dragging = false;
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
    if (locked && !now && !releasing) pressed.add("Escape");
    releasing = false;
    locked = now;
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);
  target.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("blur", onBlur);

  return {
    read(dt) {
      const p = readPad(pad, face);
      if (p) {
        if (face.a && !prev.a) pressed.add(PAD_A);
        if (face.b && !prev.b) pressed.add(PAD_B);
        if (face.start && !prev.start) pressed.add(PAD_START);
        prev.a = face.a;
        prev.b = face.b;
        prev.start = face.start;
      } else {
        // Unplugged mid-game: nothing stays held.
        prev.a = prev.b = prev.start = false;
      }
      actionsFrom(keys, pressed, mouse, p, dt, out);
      pressed.clear();
      mouse.dx = 0;
      mouse.dy = 0;
      return out;
    },
    dispose() {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      target.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onBlur);
      if (locked) document.exitPointerLock?.();
    },
    get locked() {
      return locked;
    },
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsFrom, createInput, PAD_A, type PadState } from "./input";

const NONE = new Set<string>();
const still = { dx: 0, dy: 0 };
const pad = (p: Partial<PadState>): PadState => ({
  lx: 0,
  ly: 0,
  rx: 0,
  ry: 0,
  rt: 0,
  lt: 0,
  rb: false,
  lb: false,
  l3: false,
  ...p,
});

describe("actionsFrom", () => {
  it("W moves and accelerates forward", () => {
    const a = actionsFrom(new Set(["KeyW"]), NONE, still, null);
    expect(a.move.y).toBe(1);
    expect(a.throttle).toBe(1);
    expect(a.brake).toBe(0);
  });

  it("D steers right, A left, S brakes", () => {
    expect(actionsFrom(new Set(["KeyD"]), NONE, still, null).steer).toBe(1);
    expect(actionsFrom(new Set(["ArrowLeft"]), NONE, still, null).steer).toBe(-1);
    expect(actionsFrom(new Set(["KeyS"]), NONE, still, null).brake).toBe(1);
  });

  it("a diagonal is not faster than straight", () => {
    const m = actionsFrom(new Set(["KeyW", "KeyD"]), NONE, still, null).move;
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(1);
  });

  it("a stick inside the dead zone is zero, full tilt reaches 1", () => {
    const a = actionsFrom(NONE, NONE, still, pad({ lx: 0.1, rx: 0.1 }));
    expect(a.move.x).toBe(0);
    expect(a.steer).toBe(0);
    expect(a.look.x).toBe(0);
    const f = actionsFrom(NONE, NONE, still, pad({ lx: 1 }));
    expect(f.steer).toBe(1);
    expect(f.move.x).toBe(1);
  });

  it("the pad pushes up on foot as forward (stick up is negative y)", () => {
    expect(actionsFrom(NONE, NONE, still, pad({ ly: -1 })).move.y).toBe(1);
  });

  it("triggers are throttle and brake, bumpers climb and descend", () => {
    const a = actionsFrom(NONE, NONE, still, pad({ rt: 0.6, lt: 0.3, rb: true }));
    expect(a.throttle).toBe(0.6);
    expect(a.brake).toBe(0.3);
    expect(a.up).toBe(true);
    expect(a.down).toBe(false);
  });

  it("mouse and right stick turn the view", () => {
    const a = actionsFrom(NONE, NONE, { dx: 100, dy: -50 }, pad({ ry: 1 }), 0.5);
    expect(a.look.x).toBeGreaterThan(0);
    expect(a.look.y).toBeCloseTo(-50 * 0.003 + 1.6 * 0.5);
  });

  it("Space jumps and climbs, Shift sprints and descends, A jumps and gets in", () => {
    const held = actionsFrom(new Set(["Space", "ShiftLeft"]), new Set(["Space"]), still, null);
    expect(held).toMatchObject({ jump: true, up: true, down: true, sprint: true });
    const a = actionsFrom(NONE, new Set([PAD_A]), still, pad({}));
    expect(a.jump).toBe(true);
    expect(a.use).toBe(true);
  });

  it("a pad that was tilted and then goes away gives all zeros", () => {
    const out = actionsFrom(NONE, NONE, still, pad({ lx: 1, rt: 1, rb: true, rx: 1 }));
    expect(out.steer).toBe(1);
    actionsFrom(NONE, NONE, still, null, 1 / 60, out);
    expect(out.move).toEqual({ x: 0, y: 0 });
    expect(out.look).toEqual({ x: 0, y: 0 });
    expect(out).toMatchObject({
      throttle: 0,
      brake: 0,
      steer: 0,
      up: false,
      down: false,
      sprint: false,
    });
  });
});

/** A document, window, navigator and canvas that exist only as event targets. */
function fakeDom() {
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock: vi.fn(),
  });
  const win = new EventTarget();
  const gamepads: unknown[] = [];
  const nav = { getGamepads: () => gamepads };
  const canvas = Object.assign(new EventTarget(), {
    requestPointerLock: vi.fn(() => {
      doc.pointerLockElement = canvas;
      doc.dispatchEvent(new Event("pointerlockchange"));
    }),
  });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
  const key = (type: "keydown" | "keyup", code: string) =>
    doc.dispatchEvent(Object.assign(new Event(type), { code, preventDefault: () => undefined }));
  /** The browser drops the lock by itself (its own Esc). */
  const browserUnlock = () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event("pointerlockchange"));
  };
  const press = () => canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0 }));
  const move = (movementX: number, movementY: number) =>
    doc.dispatchEvent(Object.assign(new Event("mousemove"), { movementX, movementY }));
  return {
    canvas: canvas as unknown as HTMLElement,
    doc,
    win,
    gamepads,
    key,
    browserUnlock,
    press,
    move,
  };
}

describe("createInput", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a held E uses only on the first frame", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.key("keydown", "KeyE");
    d.key("keydown", "KeyE"); // auto-repeat
    const seen = [input.read(1 / 60).use, input.read(1 / 60).use, input.read(1 / 60).use];
    expect(seen).toEqual([true, false, false]);
    input.dispose();
  });

  it("Esc exits on the first press and releases the lock once", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.press();
    expect(input.locked).toBe(true);
    d.key("keydown", "Escape");
    d.browserUnlock(); // the lock change that follows our own release
    expect(input.read(1 / 60).exit).toBe(true);
    expect(input.read(1 / 60).exit).toBe(false);
    expect(d.doc.exitPointerLock).toHaveBeenCalledTimes(1);
    input.dispose();
  });

  it("a lock dropped by the browser alone becomes exit on the next read", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.press();
    d.browserUnlock();
    expect(input.locked).toBe(false);
    expect(input.read(1 / 60).exit).toBe(true);
    expect(input.read(1 / 60).exit).toBe(false);
    input.dispose();
  });

  it("without a lock, dragging turns the view and a bare move does not", () => {
    const d = fakeDom();
    (d.canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = () => {
      throw new Error("unsupported");
    };
    const input = createInput(d.canvas);
    d.move(10, 0);
    expect(input.read(1 / 60).look.x).toBe(0);
    d.press();
    d.move(10, 0);
    expect(input.read(1 / 60).look.x).toBeGreaterThan(0);
    expect(input.read(1 / 60).look.x).toBe(0);
    input.dispose();
  });

  it("an unplugged pad zeroes the actions and does not leave A held", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    buttons[0] = { pressed: true, value: 1 };
    d.gamepads.push({ connected: true, axes: [1, 0, 0, 0], buttons });
    const a = input.read(1 / 60);
    expect(a.steer).toBe(1);
    expect(a.jump).toBe(true);
    d.gamepads.length = 0;
    const b = input.read(1 / 60);
    expect(b.steer).toBe(0);
    expect(b.jump).toBe(false);
    input.dispose();
  });

  it("blur drops held keys; dispose removes the listeners", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.key("keydown", "KeyW");
    d.win.dispatchEvent(new Event("blur"));
    expect(input.read(1 / 60).throttle).toBe(0);
    input.dispose();
    d.key("keydown", "KeyW");
    expect(input.read(1 / 60).throttle).toBe(0);
  });
});

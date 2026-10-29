import { vi } from "vitest";

/** A document, window, navigator and canvas that exist only as event targets. */
export function fakeDom() {
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock: vi.fn(),
    hidden: false,
    focused: true,
    hasFocus() {
      return this.focused;
    },
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

/** A pad as the browser reports it. `held` lists pressed button indices. */
export function gp(o: { mapping?: string; timestamp?: number; axes?: number[]; held?: number[] }) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: !!o.held?.includes(i),
    value: o.held?.includes(i) ? 1 : 0,
  }));
  return {
    connected: true,
    mapping: o.mapping ?? "standard",
    timestamp: o.timestamp ?? 0,
    axes: o.axes ?? [0, 0, 0, 0],
    buttons,
  };
}

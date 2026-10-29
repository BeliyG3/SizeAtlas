import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsFrom, createInput, type PadState } from "./input";
import { fakeDom, gp } from "./input.fixture";

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

describe("pads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers a standard pad, and one in use over an idle one", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.gamepads.push(gp({ mapping: "", axes: [1, 0, 0, 0] }), gp({}));
    expect(input.read(1 / 60).steer).toBe(0); // the standard one, though idle
    d.gamepads[1] = gp({ axes: [-1, 0, 0, 0] });
    expect(input.read(1 / 60).steer).toBe(-1);
    input.dispose();
  });

  it("switches from an idle pad to one that is moved, but does not flip-flop between two", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.gamepads.push(gp({ timestamp: 1 }), gp({ timestamp: 1 }));
    input.read(1 / 60);
    d.gamepads[1] = gp({ axes: [1, 0, 0, 0], timestamp: 2 });
    expect(input.read(1 / 60).steer).toBe(1);
    d.gamepads[0] = gp({ axes: [-1, 0, 0, 0], timestamp: 3 });
    expect(input.read(1 / 60).steer).toBe(1); // stays on the one in use
    input.dispose();
  });

  it("a button held when the pad appears or becomes the active one is not a press", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.gamepads.push(gp({ held: [0] }));
    expect(input.read(1 / 60).jump).toBe(false);
    d.gamepads[0] = gp({});
    input.read(1 / 60);
    d.gamepads[0] = gp({ held: [0] });
    expect(input.read(1 / 60).jump).toBe(true);
    // A second pad takes over with A held: still no press.
    d.gamepads[0] = gp({});
    d.gamepads[1] = gp({ held: [0] });
    expect(input.read(1 / 60).jump).toBe(false);
    input.dispose();
  });

  it("reset makes buttons held at that moment quiet", () => {
    const d = fakeDom();
    const input = createInput(d.canvas);
    d.gamepads.push(gp({}));
    input.read(1 / 60);
    d.gamepads[0] = gp({ held: [9] });
    input.reset();
    expect(input.read(1 / 60).exit).toBe(false);
    input.dispose();
  });

  it("trigger noise below the dead zone is nothing", () => {
    expect(actionsFrom(NONE, NONE, still, pad({ rt: 0.04, lt: 0.04 }))).toMatchObject({
      throttle: 0,
      brake: 0,
    });
    expect(actionsFrom(NONE, NONE, still, pad({ rt: 0.06 })).throttle).toBe(0.06);
  });
});

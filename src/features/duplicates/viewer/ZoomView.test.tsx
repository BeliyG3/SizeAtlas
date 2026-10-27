import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rt } from "../../lists/hookRuntime";
import { ZoomView, type ZoomHandle } from "./ZoomView";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../../lists/hookRuntime")).rt.hooks,
}));

type Handler = (e: object) => void;
interface Box {
  props: { onPointerDown: Handler; onPointerMove: Handler; onPointerUp: Handler; onClick: Handler };
}

const box = { setPointerCapture: vi.fn() };
const picture = {};
let shown: Box & ReactElement;

function render(onBackground: () => void) {
  rt.state.at = 0;
  shown = ZoomView({ url: "blob:1", label: "a.jpg", onBackground }) as Box & ReactElement;
  // The effects run with no element (no DOM in the tests): they do nothing.
  for (const run of rt.state.queue.splice(0)) run();
}

const press = (target: object) => ({
  button: 0,
  pointerId: 1,
  clientX: 0,
  clientY: 0,
  target,
  currentTarget: box,
});

beforeEach(() => {
  rt.state.slots = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("ZoomView", () => {
  it("shows the picture under its label", () => {
    render(() => {});
    const img = (shown.props as unknown as { children: ReactElement }).children;
    expect(img.type).toBe("img");
    expect((img.props as { alt: string }).alt).toBe("a.jpg");
  });

  it("gives a background click only for a press on the empty space that did not drag", () => {
    const onBackground = vi.fn();
    render(onBackground);
    const click = { target: box, currentTarget: box };
    shown.props.onPointerDown(press(box));
    shown.props.onPointerUp({});
    shown.props.onClick(click);
    expect(onBackground).toHaveBeenCalledTimes(1);

    // Pressed on the picture: the capture still makes the container the click target.
    shown.props.onPointerDown(press(picture));
    shown.props.onPointerUp({});
    shown.props.onClick(click);
    expect(onBackground).toHaveBeenCalledTimes(1);

    // Dragged from the empty space.
    shown.props.onPointerDown(press(box));
    shown.props.onPointerMove({ clientX: 40, clientY: 0, buttons: 1 });
    shown.props.onPointerUp({});
    shown.props.onClick(click);
    expect(onBackground).toHaveBeenCalledTimes(1);
  });
});

/** A box of 1000×1000 px holding a 2000×1000 picture, so it fits at 0.5 and pans at 1:1. */
function mounted(ref?: { current: ZoomHandle | null }) {
  let wheel: (e: object) => void = () => {};
  let resized: (entries: object[]) => void = () => {};
  const el = {
    ...box,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener: (_: string, h: typeof wheel) => (wheel = h),
    removeEventListener: () => {},
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resized) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  // The box ref is the first hook: give it an element before the effects run.
  rt.state.slots = [{ value: { current: el } }];
  const draw = () => {
    rt.state.at = 0;
    shown = ZoomView({ url: "blob:1", label: "a.jpg", ref }) as Box & ReactElement;
    for (const run of rt.state.queue.splice(0)) run();
    return (shown.props as unknown as { children: ReactElement<Img> }).children;
  };
  draw();
  resized([{ contentRect: { width: 1000, height: 1000 } }]);
  draw().props.onLoad({ currentTarget: { naturalWidth: 2000, naturalHeight: 1000 } });
  const transform = () => draw().props.style.transform;
  return { el, wheel: (e: object) => wheel(e), transform, draw };
}
interface Img {
  style: { transform: string };
  onLoad: (e: object) => void;
  onError?: () => void;
}
const at = (x: number, more: object = {}) => ({
  ...press(box),
  clientX: x,
  clientY: 500,
  buttons: 1,
  ...more,
});

describe("ZoomView zoom and drag", () => {
  it("never zooms on a sideways wheel, and keeps it from scrolling anything", () => {
    const view = mounted();
    expect(view.transform()).toBe("translate(0px, 250px) scale(0.5)");
    view.wheel({ deltaY: -100, clientX: 0, clientY: 0, preventDefault: vi.fn() });
    expect(view.transform()).toContain("scale(0.6)");
    const sideways = { deltaY: 0, deltaX: 100, clientX: 0, clientY: 0, preventDefault: vi.fn() };
    view.wheel(sideways);
    expect(sideways.preventDefault).toHaveBeenCalled();
    expect(view.transform()).toContain("scale(0.6)");
  });

  it("ends a drag when no button is down any more or the capture is lost", () => {
    const view = mounted();
    (shown.props as unknown as { onDoubleClick: Handler }).onDoubleClick({
      clientX: 500,
      clientY: 500,
      currentTarget: view.el,
    });
    expect(view.transform()).toBe("translate(-500px, 0px) scale(1)");
    shown.props.onPointerDown(at(500));
    shown.props.onPointerMove(at(600));
    expect(view.transform()).toBe("translate(-400px, 0px) scale(1)");
    // The button went up outside the window: the drag is over.
    shown.props.onPointerMove(at(700, { buttons: 0 }));
    shown.props.onPointerMove(at(800));
    expect(view.transform()).toBe("translate(-400px, 0px) scale(1)");

    shown.props.onPointerDown(at(500));
    (shown.props as unknown as { onLostPointerCapture: Handler }).onLostPointerCapture({});
    shown.props.onPointerMove(at(600));
    expect(view.transform()).toBe("translate(-400px, 0px) scale(1)");
  });

  it("tells about a picture it cannot decode", () => {
    const onError = vi.fn();
    rt.state.at = 0;
    const img = (
      ZoomView({ url: "blob:1", label: "a.jpg", onError }).props as { children: ReactElement<Img> }
    ).children;
    img.props.onError!();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("fits and shows the actual size on demand", () => {
    const ref: { current: ZoomHandle | null } = { current: null };
    const view = mounted(ref);
    ref.current!.actual();
    expect(view.transform()).toBe("translate(-500px, 0px) scale(1)");
    ref.current!.fit();
    expect(view.transform()).toBe("translate(0px, 250px) scale(0.5)");
  });
});

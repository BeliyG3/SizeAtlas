import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rt } from "../../lists/hookRuntime";
import { ZoomView } from "./ZoomView";

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
    shown.props.onPointerMove({ clientX: 40, clientY: 0 });
    shown.props.onPointerUp({});
    shown.props.onClick(click);
    expect(onBackground).toHaveBeenCalledTimes(1);
  });
});

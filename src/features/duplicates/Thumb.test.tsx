import { Fragment, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { DupGroup } from "../../api/duplicates";
import { ItemIcon } from "../contents/ItemIcon";
import { rt } from "../lists/hookRuntime";
import { copy, group } from "./dup.testSupport";
import { Thumb } from "./Thumb";
import { createThumbQueue } from "./thumbs";
import { HoverZoom } from "./viewer/HoverZoom";
import { HOVER_DELAY } from "./viewer/hover";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getThumbnail: vi.fn() } }));
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));

const queue = createThumbQueue();
let shown: ReactElement;

function render(g: DupGroup) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = Thumb({ group: g, queue }) as ReactElement;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the thumbnail never settled");
}

/** What the thumbnail shows: the picture and, while hovered, the larger copy; or the icon. */
const parts = () => {
  if (shown.type !== Fragment) return [shown];
  const { children } = shown.props as { children: unknown };
  return [children].flat().filter(Boolean) as ReactElement[];
};
const picture = () => parts()[0];
const popup = () => parts().find((p) => p.type === HoverZoom);

async function settle(g: DupGroup) {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  render(g);
}

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Thumb", () => {
  it("shows the picture from a Blob URL, and revokes it when another file is shown", async () => {
    vi.mocked(api.getThumbnail).mockResolvedValue(new ArrayBuffer(3));
    const first = group("a");
    render(first);
    expect(shown.type).toBe(ItemIcon);
    await settle(first);
    expect(api.getThumbnail).toHaveBeenCalledWith(first.copies[0].refs[0]);
    expect(picture().type).toBe("img");
    expect((picture().props as { src: string }).src).toBe("blob:one");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/jpeg");
    // The group lost its first copy: another file, the icon until its picture comes.
    const other = { ...first, copies: [copy(7), copy(8)] };
    render(other);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(shown.type).toBe(ItemIcon);
  });

  it("never keeps a revoked URL on screen when the same file is read as another type", async () => {
    vi.mocked(api.getThumbnail).mockResolvedValue(new ArrayBuffer(3));
    const first = group("a");
    render(first);
    await settle(first);
    expect(picture().type).toBe("img");
    render({ ...first, name: "a.png" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(shown.type).toBe(ItemIcon);
  });

  it("reads a copy that is not on a spinning disk, if there is one", async () => {
    vi.mocked(api.getThumbnail).mockResolvedValue(new ArrayBuffer(3));
    const spinning = { root: "E:\\", generation: 3, id: 1 };
    const g = group("h", 0, {
      copies: [copy(1, { hdd: true, refs: [spinning] }), copy(2)],
    });
    render(g);
    await settle(g);
    expect(api.getThumbnail).toHaveBeenCalledWith(g.copies[1].refs[0]);
    rt.state.slots = [];
    const all = group("i", 0, { copies: [copy(1, { hdd: true, refs: [spinning] })] });
    render(all);
    expect(api.getThumbnail).toHaveBeenLastCalledWith(spinning);
  });

  it("keeps the icon for an empty answer, a failure or a name of no image type", async () => {
    vi.mocked(api.getThumbnail).mockResolvedValueOnce(new ArrayBuffer(0));
    const empty = group("e");
    render(empty);
    await settle(empty);
    expect(shown.type).toBe(ItemIcon);

    rt.state.slots = [];
    vi.mocked(api.getThumbnail).mockRejectedValueOnce(new Error("gone"));
    const failed = group("f");
    render(failed);
    await settle(failed);
    expect(shown.type).toBe(ItemIcon);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    rt.state.slots = [];
    vi.mocked(api.getThumbnail).mockClear();
    render(group("t", 0, { name: "notes.txt" }));
    expect(api.getThumbnail).not.toHaveBeenCalled();
  });

  describe("hover zoom", () => {
    type Handlers = Record<string, (e?: unknown) => void>;
    const listeners = new Map<string, () => void>();
    const on = () => picture().props as Handlers;
    const at = (clientX: number, clientY: number) => ({ clientX, clientY });
    const rest = (g: DupGroup, ms: number) => {
      vi.advanceTimersByTime(ms);
      render(g);
    };

    async function ready() {
      vi.mocked(api.getThumbnail).mockResolvedValue(new ArrayBuffer(3));
      const g = group("a");
      render(g);
      await settle(g);
      return g;
    }

    beforeEach(() => {
      listeners.clear();
      vi.stubGlobal("window", {
        addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
        removeEventListener: (type: string) => listeners.delete(type),
      });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("shows the larger picture after the delay at the pointer, and follows it", async () => {
      const g = await ready();
      vi.useFakeTimers();
      on().onPointerEnter(at(10, 20));
      render(g);
      rest(g, HOVER_DELAY - 1);
      expect(popup()).toBeUndefined();
      rest(g, 1);
      expect(popup()?.props).toEqual({ url: "blob:one", at: { x: 10, y: 20 } });
      on().onPointerMove(at(30, 40));
      render(g);
      expect(popup()?.props).toEqual({ url: "blob:one", at: { x: 30, y: 40 } });
    });

    it("restarts the delay while the pointer moves, and never shows after leaving", async () => {
      const g = await ready();
      vi.useFakeTimers();
      on().onPointerEnter(at(1, 1));
      render(g);
      rest(g, 300);
      on().onPointerMove(at(2, 2));
      render(g);
      rest(g, 300);
      expect(popup()).toBeUndefined();
      on().onPointerLeave();
      render(g);
      rest(g, 1000);
      expect(popup()).toBeUndefined();
    });

    it.each(["scroll", "pointerdown", "keydown", "wheel"])("hides on %s", async (type) => {
      const g = await ready();
      vi.useFakeTimers();
      on().onPointerEnter(at(1, 1));
      render(g);
      rest(g, HOVER_DELAY);
      expect(popup()).toBeDefined();
      listeners.get(type)?.();
      render(g);
      expect(popup()).toBeUndefined();
      expect(listeners.size).toBe(0);
    });

    it("hides when the picture goes away", async () => {
      const g = await ready();
      vi.useFakeTimers();
      on().onPointerEnter(at(1, 1));
      render(g);
      rest(g, HOVER_DELAY);
      expect(popup()).toBeDefined();
      render({ ...g, name: "a.png" });
      expect(shown.type).toBe(ItemIcon);
      rest({ ...g, name: "a.png" }, 1000);
      expect(shown.type).toBe(ItemIcon);
      render(g);
      expect(popup()).toBeUndefined();
    });
  });
});

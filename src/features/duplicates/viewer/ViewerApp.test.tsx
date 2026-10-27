import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../api/client";
import { rt } from "../../lists/hookRuntime";
import { ViewerApp } from "./ViewerApp";
import { onViewerShow, viewerReady, type ViewerPicture } from "./viewerWindow";
import { ZoomView } from "./ZoomView";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../../api/client", () => ({ api: { getThumbnail: vi.fn() } }));
vi.mock("../../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("./viewerWindow", () => ({ onViewerShow: vi.fn(), viewerReady: vi.fn() }));

const createObjectURL = vi.fn<(b: Blob) => string>();
const revokeObjectURL = vi.fn();
let show: (p: ViewerPicture | null) => void;
let shown: ReactElement<{ children: ReactElement }>;
let urls = 0;

function render() {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    shown = ViewerApp() as typeof shown;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the viewer never settled");
}

/** Lets the pending promises run, then renders what they set. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  render();
}

const content = () => shown.props.children;
const zoomUrl = () => {
  const c = content();
  return c.type === ZoomView ? (c.props as { url: string }).url : null;
};
const picture = (key: string): ViewerPicture => ({
  ref: { root: "C:\\", generation: 1, id: key.charCodeAt(0) },
  name: `${key}.png`,
  key,
});

function deferred() {
  let resolve!: (bytes: ArrayBuffer) => void;
  const promise = new Promise<ArrayBuffer>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  rt.state.slots = [];
  vi.clearAllMocks();
  urls = 0;
  createObjectURL.mockImplementation(() => `blob:${++urls}`);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("document", { title: "" });
  vi.mocked(onViewerShow).mockImplementation((run) => {
    show = run;
    return Promise.resolve(() => {});
  });
  vi.mocked(viewerReady).mockResolvedValue();
  render();
  await settle();
});
afterEach(() => vi.unstubAllGlobals());

describe("ViewerApp", () => {
  it("asks_for_the_picture_when_it_opens", () => {
    expect(onViewerShow).toHaveBeenCalledTimes(1);
    expect(viewerReady).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onViewerShow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(viewerReady).mock.invocationCallOrder[0],
    );
  });

  it("shows_the_picture_it_is_sent", async () => {
    expect(document.title).toBe("dup.view.title");
    vi.mocked(api.getThumbnail).mockResolvedValue(new ArrayBuffer(4));
    show(picture("a"));
    await settle();
    expect(api.getThumbnail).toHaveBeenCalledWith(picture("a").ref);
    expect(zoomUrl()).toBe("blob:1");
    expect(createObjectURL.mock.calls[0][0].type).toBe("image/png");
  });

  it("shows_the_empty_text", async () => {
    expect(content().props).toMatchObject({ children: "dup.view.empty" });
    vi.mocked(api.getThumbnail).mockResolvedValueOnce(new ArrayBuffer(4));
    show(picture("a"));
    await settle();
    show(null);
    await settle();
    expect(zoomUrl()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");

    vi.mocked(api.getThumbnail).mockRejectedValueOnce(new Error("stale"));
    show(picture("b"));
    await settle();
    expect(zoomUrl()).toBeNull();

    vi.mocked(api.getThumbnail).mockResolvedValueOnce(new ArrayBuffer(0));
    show(picture("c"));
    await settle();
    expect(zoomUrl()).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("one_read_at_a_time", async () => {
    const a = deferred();
    const c = deferred();
    vi.mocked(api.getThumbnail).mockReturnValueOnce(a.promise).mockReturnValueOnce(c.promise);
    show(picture("a"));
    show(picture("b"));
    show(picture("c"));
    await settle();
    expect(api.getThumbnail).toHaveBeenCalledTimes(1);
    a.resolve(new ArrayBuffer(4));
    await settle();
    expect(vi.mocked(api.getThumbnail).mock.calls.map(([r]) => r.id)).toEqual([97, 99]);
    c.resolve(new ArrayBuffer(4));
    await settle();
    expect(api.getThumbnail).toHaveBeenCalledTimes(2);
    expect(zoomUrl()).toBe(`blob:${urls}`);

    // The next one shown revokes the previous URL.
    const d = deferred();
    vi.mocked(api.getThumbnail).mockReturnValueOnce(d.promise);
    const before = zoomUrl();
    show(picture("d"));
    d.resolve(new ArrayBuffer(4));
    await settle();
    expect(revokeObjectURL).toHaveBeenCalledWith(before);
    expect(zoomUrl()).toBe(`blob:${urls}`);
  });

  it("reads nothing once it is gone", async () => {
    for (const s of rt.state.slots) if (typeof s.cleanup === "function") s.cleanup();
    // The listener of the cleaned-up effect still runs before its unlisten takes hold.
    show(picture("a"));
    await settle();
    expect(api.getThumbnail).not.toHaveBeenCalled();
  });

  it("drops the pending picture on a null", async () => {
    const a = deferred();
    vi.mocked(api.getThumbnail).mockReturnValueOnce(a.promise);
    show(picture("a"));
    show(picture("b"));
    show(null);
    a.resolve(new ArrayBuffer(4));
    await settle();
    expect(api.getThumbnail).toHaveBeenCalledTimes(1);
    expect(zoomUrl()).toBeNull();
  });
});

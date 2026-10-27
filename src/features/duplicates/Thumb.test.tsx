import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { DupGroup } from "../../api/duplicates";
import { ItemIcon } from "../contents/ItemIcon";
import { rt } from "../lists/hookRuntime";
import { copy, group } from "./dup.testSupport";
import { Thumb } from "./Thumb";
import { createThumbQueue } from "./thumbs";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getThumbnail: vi.fn() } }));

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
    expect(shown.type).toBe("img");
    expect((shown.props as { src: string }).src).toBe("blob:one");
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
    expect(shown.type).toBe("img");
    render({ ...first, name: "a.png" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(shown.type).toBe(ItemIcon);
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
});

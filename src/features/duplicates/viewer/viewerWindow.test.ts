import { emit, listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DupGroup } from "../../../api/duplicates";
import { rt } from "../../lists/hookRuntime";
import { copy, group } from "../dup.testSupport";
import { READY_EVENT, SHOW_EVENT, useViewerSync } from "./viewerWindow";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../../lists/hookRuntime")).rt.hooks,
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(),
}));

const unlisten = vi.fn();
let ready: () => void;
let resolveListen: (u: () => void) => void;
const Shell = (selected: DupGroup | null) => useViewerSync(selected);

function render(selected: DupGroup | null) {
  rt.state.at = 0;
  Shell(selected);
  for (const run of rt.state.queue.splice(0)) run();
}

/** Runs every cleanup, as an unmount does. */
function unmount() {
  for (const s of rt.state.slots) if (typeof s.cleanup === "function") s.cleanup();
}

const sent = () =>
  vi
    .mocked(emit)
    .mock.calls.filter(([e]) => e === SHOW_EVENT)
    .map(([, p]) => p);

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation((event, handler) => {
    expect(event).toBe(READY_EVENT);
    ready = () => handler({ event, id: 0, payload: undefined });
    return new Promise((resolve) => (resolveListen = resolve));
  });
});

describe("useViewerSync", () => {
  it("sends a picture once per change", () => {
    render(group("a"));
    expect(sent()).toEqual([
      { ref: { root: "C:\\", generation: 1, id: 1 }, name: "a.jpg", key: "a" },
    ]);
    // Another object, the same key, generation and id.
    render(group("a"));
    expect(sent()).toHaveLength(1);
    render(group("a", 4096, { copies: [copy(7)] }));
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({ ref: { id: 7 } });
    render(group("b"));
    expect(sent()).toHaveLength(3);
  });

  it("ready_resends_the_same_picture", async () => {
    render(group("a"));
    resolveListen(unlisten);
    await Promise.resolve();
    ready();
    ready();
    expect(sent()).toHaveLength(3);
    expect(sent()[2]).toMatchObject({ key: "a" });
    render(null);
    ready();
    expect(sent().at(-1)).toBeNull();
  });

  it("sends null for a group without a picture", () => {
    render(group("a", 4096, { name: "a.txt" }));
    expect(sent()).toEqual([null]);
  });

  it("sends null and unlistens on the cleanup", async () => {
    render(group("a"));
    resolveListen(unlisten);
    await Promise.resolve();
    unmount();
    expect(sent().at(-1)).toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens at once when the listener comes after the cleanup", async () => {
    render(group("a"));
    unmount();
    expect(unlisten).not.toHaveBeenCalled();
    resolveListen(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

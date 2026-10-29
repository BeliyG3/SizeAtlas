import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Summary } from "../../api/types";
import { rt } from "../lists/hookRuntime";
import { CityPane } from "./CityPane";
import { CityView } from "./CityView";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getCity: vi.fn(), getCrumbs: vi.fn() } }));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("./CityView", () => ({ CityView: () => null }));

const summary = (generation: number, rev: number, scanning = false) =>
  ({ root: "/r", generation, rev, scanning }) as Summary;
const selection = (generation: number | null, id: number) => ({
  root: "/r",
  generation,
  id,
  folder: id,
});

const onSelect = vi.fn();
const onFail = vi.fn();
let tree: ReactElement<Record<string, unknown>>;

function render(props: Pick<Parameters<typeof CityPane>[0], "summary" | "selection">) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    tree = CityPane({ ...props, onSelect, onFail }) as typeof tree;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the pane never settled");
}

const view = () => (tree.type === CityView ? tree.props : null);

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CityPane", () => {
  it.each([
    ["no root is selected", null, null],
    ["the root has no tree yet", null, selection(null, 0)],
  ])("asks for a scan when %s, and requests nothing", (_, root, chosen) => {
    render({ summary: root, selection: chosen });
    expect(view()).toBeNull();
    expect(api.getCity).not.toHaveBeenCalled();
    expect(api.getCrumbs).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("shows the hint text", () => {
    render({ summary: null, selection: null });
    expect(JSON.stringify(tree.props)).toContain("city.empty");
  });

  it("shows the selected root's tree with the selected node", () => {
    render({ summary: summary(3, 7), selection: selection(3, 42) });
    expect(view()).toMatchObject({ generation: 3, rev: 7, selectedId: 42, onFail });
    (view()!.onSelect as (id: number, isDir: boolean) => void)(9, false);
    expect(onSelect).toHaveBeenCalledWith(3, 9, false);
  });

  it("lights the whole root for a selection of another tree", () => {
    render({ summary: summary(3, 7), selection: selection(2, 42) });
    expect(view()!.selectedId).toBe(0);
  });

  it("follows a live scan at the city cadence", () => {
    render({ summary: summary(3, 1, true), selection: selection(3, 0) });
    expect(view()!.rev).toBe(1);
    render({ summary: summary(3, 2, true), selection: selection(3, 0) });
    expect(view()!.rev).toBe(1);
    vi.advanceTimersByTime(10_000);
    render({ summary: summary(3, 2, true), selection: selection(3, 0) });
    expect(view()!.rev).toBe(2);
  });

  it("shows a switched root's own revision, not the last root's", () => {
    render({ summary: summary(3, 1, true), selection: selection(3, 0) });
    render({ summary: summary(3, 2, true), selection: selection(3, 0) });
    render({ summary: summary(4, 9, true), selection: selection(4, 0) });
    expect(view()).toMatchObject({ generation: 4, rev: 9 });
  });
});

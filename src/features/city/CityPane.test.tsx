import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rt } from "../lists/hookRuntime";
import { CityPane } from "./CityPane";
import { CityView } from "./CityView";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("./CityView", () => ({ CityView: () => null }));

const roots = [
  { generation: 3, rev: 7 },
  { generation: 4, rev: 9 },
];
const selection = (generation: number | null, id: number) => ({ generation, id });

const onSelect = vi.fn();
const onFail = vi.fn();
let tree: ReactElement<Record<string, unknown>>;

function render(chosen: ReturnType<typeof selection> | null) {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    tree = CityPane({ roots, selection: chosen, onSelect, onFail }) as typeof tree;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the pane never settled");
}

const view = () => (tree.type === CityView ? tree.props : null);

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
});

describe("CityPane", () => {
  it.each([
    ["no root is selected", null],
    ["the selected root has no tree yet", selection(null, 0)],
  ])("shows only the hint when %s", (_, chosen) => {
    render(chosen);
    expect(view()).toBeNull();
    expect(JSON.stringify(tree.props)).toContain("city.empty");
    expect(onFail).not.toHaveBeenCalled();
  });

  it("shows the open roots around the selected node", () => {
    render(selection(3, 42));
    expect(view()).toMatchObject({ roots, generation: 3, selectedId: 42, onSelect, onFail });
  });
});

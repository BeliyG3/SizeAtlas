import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { rt } from "../lists/hookRuntime";
import { CityView } from "./CityView";
import { createScene, type Hover } from "./scene";
import { useArchipelago } from "./useArchipelago";
import type { Building } from "./world/buildings";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getCrumbs: vi.fn(() => new Promise(() => {})) } }));
vi.mock("./useArchipelago", () => ({ useArchipelago: vi.fn() }));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", async () => {
  const { PALETTES } = await import("../../palette");
  return {
    useSize: () => String,
    usePalette: () => PALETTES.dark,
    useSettings: () => ({ resolved: "dark" }),
  };
});
vi.mock("./scene", () => ({ createScene: vi.fn() }));

const roots = [
  { generation: 1, rev: 1 },
  { generation: 2, rev: 4 },
];
const props = { roots, generation: 1, selectedId: 0, onSelect: vi.fn(), onFail: vi.fn() };
/** Two islands, the drives of generations 1 and 2. */
const islands = [
  { generation: 1, rev: 1, build: 1, root: "/a", x: 0, z: 0 },
  { generation: 2, rev: 4, build: 2, root: "/b", x: 300, z: 0 },
];
let tree: ReactElement;

function render() {
  for (let pass = 0; pass < 20; pass++) {
    rt.state.at = 0;
    rt.state.dirty = false;
    tree = CityView(props) as ReactElement;
    for (const run of rt.state.queue.splice(0)) run();
    if (!rt.state.dirty) return;
  }
  throw new Error("the view never settled");
}

/** Every element of the tree, depth first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const el = node as ReactElement<{ children?: ReactNode }>;
  return [el as ReactElement<Record<string, unknown>>, ...elements(el.props.children)];
}

const texts = () => elements(tree).flatMap((el) => [el.props.children].flat());
const canvas = () => elements(tree).find((el) => el.type === "canvas");

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.mocked(useArchipelago).mockReturnValue({
    world: null,
    islands,
    selectedIsland: 0,
    finish: null,
  });
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#181818" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CityView", () => {
  it("says the 3D view is unavailable when the renderer cannot start", async () => {
    vi.mocked(createScene).mockImplementation(() => {
      throw new Error("Error creating WebGL context.");
    });
    render();
    expect(useArchipelago).toHaveBeenCalledWith(roots, { generation: 1, id: 0 }, props.onFail);
    (canvas()!.props.ref as (el: unknown) => void)({});
    render();
    await vi.dynamicImportSettled();
    render();
    expect(createScene).toHaveBeenCalledTimes(1);
    expect(texts()).toContain("city.unavailable");
    expect(canvas()).toBeUndefined();
    expect(props.onFail).not.toHaveBeenCalled();
  });

  it("shows the canvas and the reset button once the renderer starts", async () => {
    const scene = { setCity: vi.fn(), setTheme: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
    vi.mocked(createScene).mockReturnValue(scene);
    render();
    (canvas()!.props.ref as (el: unknown) => void)({});
    render();
    await vi.dynamicImportSettled();
    render();
    expect(texts()).not.toContain("city.unavailable");
    expect(texts()).toContain("city.reset");
    // No island yet: the map is still being worked out.
    expect(texts()).toContain("city.building");
    expect(scene.setCity).toHaveBeenCalledWith(null, 1);
    expect(scene.setTheme).toHaveBeenCalledWith({
      palette: expect.objectContaining({ dirFill: "#20232b" }),
      background: "#181818",
    });
  });

  describe("the tooltip", () => {
    const house = { island: 0, id: 5, parent: 4, kind: "folder", size: 10 } as Building;
    const filler = { island: 0, id: 7, parent: 6, kind: "filler", size: 30 } as Building;
    const events = () => vi.mocked(createScene).mock.calls[0][2];
    const hover = (x: number, y: number, building = house) =>
      events().onHover({ building, x, y, w: 250, h: 300 } as Hover);
    const tip = () => elements(tree).find((el) => el.props.className === "city-tip");
    const fake = { offsetWidth: 200, offsetHeight: 40, style: {} as Record<string, string> };

    async function start() {
      const scene = { setCity: vi.fn(), setTheme: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
      vi.mocked(createScene).mockReturnValue(scene);
      render();
      (canvas()!.props.ref as (el: unknown) => void)({});
      render();
      await vi.dynamicImportSettled();
      render();
    }

    it("stays inside the panel, flipped and clamped beside the pointer", async () => {
      await start();
      hover(20, 20);
      render();
      (tip()!.props.ref as { current: unknown }).current = fake;
      render();
      expect(fake.style).toMatchObject({ left: "34px", top: "34px" });
      // No room on either side of the pointer: the left edge, never past it.
      hover(100, 290);
      render();
      expect(fake.style).toMatchObject({ left: "0px", top: "236px" });
    });

    it("never names a block with the previous root's crumbs", async () => {
      vi.mocked(api.getCrumbs).mockImplementation((generation) =>
        Promise.resolve([{ id: 5, name: `root${generation}`, size: 1, rank: 0 }]),
      );
      await start();
      vi.useFakeTimers();
      hover(20, 20);
      render();
      await vi.advanceTimersByTimeAsync(200);
      render();
      expect(texts()).toContain("root1");
      // The island the building stands on is another root's now.
      vi.mocked(useArchipelago).mockReturnValue({
        world: null,
        islands: [islands[1]],
        selectedIsland: 0,
        finish: null,
      });
      render();
      hover(20, 20);
      render();
      expect(texts()).not.toContain("root1");
      vi.useRealTimers();
    });

    it("names a house of the second island with that root's crumbs", async () => {
      vi.mocked(api.getCrumbs).mockImplementation((generation, id) =>
        Promise.resolve([{ id, name: `g${generation}n${id}`, size: 1, rank: 0 }]),
      );
      await start();
      vi.useFakeTimers();
      hover(20, 20, { ...house, island: 1 } as Building);
      render();
      await vi.advanceTimersByTimeAsync(200);
      render();
      expect(api.getCrumbs).toHaveBeenLastCalledWith(2, 5);
      expect(texts()).toContain("g2n5");
      vi.useRealTimers();
    });

    it("names the folder of a house and the block of a filler", async () => {
      vi.mocked(api.getCrumbs).mockImplementation((_, id) =>
        Promise.resolve([{ id, name: `n${id}`, size: 1, rank: 0 }]),
      );
      await start();
      vi.useFakeTimers();
      hover(20, 20);
      render();
      await vi.advanceTimersByTimeAsync(200);
      render();
      expect(texts()).toContain("n5");
      expect(texts()).toContain("city.folder");
      hover(20, 20, filler);
      render();
      await vi.advanceTimersByTimeAsync(200);
      render();
      expect(api.getCrumbs).toHaveBeenLastCalledWith(1, 6);
      expect(texts()).toContain("n6");
      expect(texts()).toContain("city.others");
      expect(texts()).not.toContain("city.folder");
      vi.useRealTimers();
    });
  });

  it("a click selects the house's folder, or the block of a filler", async () => {
    const scene = { setCity: vi.fn(), setTheme: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
    vi.mocked(createScene).mockReturnValue(scene);
    render();
    (canvas()!.props.ref as (el: unknown) => void)({});
    render();
    await vi.dynamicImportSettled();
    render();
    const { onPick } = vi.mocked(createScene).mock.calls[0][2];
    onPick({ island: 0, id: 5, parent: 4, kind: "folder" } as Building);
    expect(props.onSelect).toHaveBeenLastCalledWith(1, 5);
    onPick({ island: 0, id: 7, parent: 6, kind: "filler" } as Building);
    expect(props.onSelect).toHaveBeenLastCalledWith(1, 6);
  });

  it("a click on a house of the second island selects that root's folder", async () => {
    const scene = { setCity: vi.fn(), setTheme: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
    vi.mocked(createScene).mockReturnValue(scene);
    render();
    (canvas()!.props.ref as (el: unknown) => void)({});
    render();
    await vi.dynamicImportSettled();
    render();
    const { onPick } = vi.mocked(createScene).mock.calls[0][2];
    onPick({ island: 1, id: 5, parent: 4, kind: "folder" } as Building);
    expect(props.onSelect).toHaveBeenLastCalledWith(2, 5);
    // An island the view no longer has selects nothing.
    props.onSelect.mockClear();
    onPick({ island: 7, id: 5, parent: 4, kind: "folder" } as Building);
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { rt } from "../lists/hookRuntime";
import { CityView } from "./CityView";
import { createScene, type Hover } from "./scene";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({
  api: {
    getCity: vi.fn(() => new Promise(() => {})),
    getCrumbs: vi.fn(() => new Promise(() => {})),
  },
}));
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

const props = { generation: 1, rev: 1, selectedId: 0, onSelect: vi.fn(), onFail: vi.fn() };
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
  props.generation = 1;
  rt.state.slots = [];
  vi.clearAllMocks();
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
    expect(api.getCity).toHaveBeenCalledWith(1);
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
    expect(scene.setCity).toHaveBeenCalledWith(null, 1);
    expect(scene.setTheme).toHaveBeenCalledWith({
      palette: expect.objectContaining({ dirFill: "#20232b" }),
      background: "#181818",
    });
  });

  describe("the tooltip", () => {
    const block = { id: 5, isDir: false, size: 10 };
    const hover = (x: number, y: number) =>
      vi.mocked(createScene).mock.calls[0][2].onHover({ block, x, y, w: 250, h: 300 } as Hover);
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
      props.generation = 2;
      render();
      hover(20, 20);
      render();
      expect(texts()).not.toContain("root1");
      vi.useRealTimers();
    });
  });
});

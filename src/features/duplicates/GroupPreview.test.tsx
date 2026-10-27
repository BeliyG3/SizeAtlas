import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DupGroup } from "../../api/duplicates";
import { ItemIcon } from "../contents/ItemIcon";
import { rt } from "../lists/hookRuntime";
import { copy, group } from "./dup.testSupport";
import { GroupTitle, PreviewPicture } from "./GroupPreview";
import type { Picture } from "./viewer/useImageUrl";
import { ZoomView } from "./viewer/ZoomView";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));
vi.mock("../../settings/react", () => ({ useSize: () => (n: number) => `${n} B` }));
vi.mock("../../api/client", () => ({ api: { openItem: vi.fn(), openWith: vi.fn() } }));

type Props = { children?: ReactNode; onClick?: () => void; onDoubleClick?: () => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

const onFull = vi.fn();
const onWindow = vi.fn();
const onFail = vi.fn();

/**
 * The module afresh on a Windows agent (`WINDOWS` is read once, when it loads), with the api and
 * the icon it uses: resetModules re-runs the mock factories and reloads the icon.
 */
async function onWindows() {
  vi.stubGlobal("navigator", { userAgent: "Windows" });
  vi.resetModules();
  const preview = await import("./GroupPreview");
  const { api } = await import("../../api/client");
  const { ItemIcon } = await import("../contents/ItemIcon");
  vi.mocked(api.openItem).mockResolvedValue();
  vi.mocked(api.openWith).mockResolvedValue();
  return { ...preview, api, ItemIcon };
}

type Title = typeof GroupTitle;
const buttons = (Title: Title, g: DupGroup, target = g.copies[0]) =>
  elements(Title({ group: g, target, onFull, onWindow, onFail }))
    .filter((e) => e.type === "button")
    .map((e) => ({
      label: [e.props.children].flat(2).find((c) => typeof c === "string"),
      click: e.props.onClick!,
    }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("the title of a group", () => {
  it("shows_the_buttons_of_a_picture", async () => {
    const { GroupTitle, api } = await onWindows();
    const g = group("a");
    const shown = buttons(GroupTitle, g);
    expect(shown.map((b) => b.label)).toEqual([
      "menu.open",
      "menu.openWith",
      "dup.view.full",
      "dup.view.window",
    ]);
    shown[0].click();
    const ref = g.copies[0].refs[0];
    expect(api.openItem).toHaveBeenCalledWith(ref.generation, ref.id);
    shown[1].click();
    expect(api.openWith).toHaveBeenCalledWith(ref.generation, ref.id);
    shown[2].click();
    expect(onFull).toHaveBeenCalledOnce();
    shown[3].click();
    expect(onWindow).toHaveBeenCalledOnce();
  });

  it("keeps_the_buttons_while_the_picture_loads", async () => {
    const { GroupTitle, PreviewPicture, ItemIcon } = await onWindows();
    const g = group("a");
    expect(buttons(GroupTitle, g)).toHaveLength(4);
    const area = PreviewPicture({ group: g, picture: { state: "loading" } });
    expect(elements(area).some((e) => e.type === ItemIcon)).toBe(true);
    expect(elements(area).some((e) => e.type === "img" || e.type === ZoomView)).toBe(false);
  });

  it("offers_only_opening_without_a_picture", async () => {
    const text = group("t", 0, { name: "notes.txt" });
    // The module loaded at the top, on the agent of node.
    expect(buttons(GroupTitle, text).map((b) => b.label)).toEqual(["menu.open"]);
    const windows = await onWindows();
    expect(buttons(windows.GroupTitle, text).map((b) => b.label)).toEqual([
      "menu.open",
      "menu.openWith",
    ]);
  });

  it("opens_the_copy_under_the_cursor", async () => {
    const { GroupTitle, api } = await onWindows();
    const g = group("a", 0, { copies: [copy(1), copy(2), copy(3)] });
    buttons(GroupTitle, g, g.copies[1])[0].click();
    expect(api.openItem).toHaveBeenCalledWith(1, 2);
  });

  it("writes the count of copies with the number format of the language", () => {
    const copies = Array.from({ length: 1234 }, (_, i) => copy(i + 1));
    const tree = GroupTitle({
      group: group("a", 0, { copies }),
      target: copies[0],
      onFull,
      onWindow,
      onFail,
    });
    expect(JSON.stringify(tree)).toContain('dup.copies {\\"count\\":1234,\\"copies\\":\\"1,234\\"');
  });

  it("keeps the name on one line that ends in an ellipsis, the whole of it in a tooltip", () => {
    const tree = GroupTitle({ group: group("a"), target: undefined, onFull, onWindow, onFail });
    const named = elements(tree).find(
      (e) => (e.props as { className?: string }).className === "dup-name",
    );
    const props = named!.props as { title?: string; children?: unknown };
    expect(props.title).toContain("dup.copies");
    expect(props.title).toBe(props.children);
  });

  it("reports a failed opening", async () => {
    const { GroupTitle, api } = await onWindows();
    const error = new Error("gone");
    vi.mocked(api.openItem).mockRejectedValue(error);
    buttons(GroupTitle, group("a"))[0].click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onFail).toHaveBeenCalledWith(error);
  });
});

describe("the picture of a group", () => {
  const ready: Picture = { state: "ready", url: "blob:one" };

  it("zooms_and_pans_the_picture_in_place", () => {
    const zoom = elements(PreviewPicture({ group: group("a"), picture: ready })).find(
      (e) => e.type === ZoomView,
    )!;
    expect((zoom.props as { url?: string }).url).toBe("blob:one");
  });

  it("shows the icon of the category without a picture, or when it cannot be decoded", () => {
    rt.state.slots = [];
    const g = group("a");
    const area = (picture: Picture) => {
      rt.state.at = 0;
      return elements(PreviewPicture({ group: g, picture }));
    };
    expect(area({ state: "none" }).some((e) => e.type === ItemIcon)).toBe(true);
    const zoom = area(ready).find((e) => e.type === ZoomView)!;
    (zoom.props as { onError: () => void }).onError();
    expect(area(ready).some((e) => e.type === ItemIcon)).toBe(true);
    expect(area({ state: "ready", url: "blob:two" }).some((e) => e.type === ZoomView)).toBe(true);
  });
});

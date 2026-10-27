import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemIcon } from "../../contents/ItemIcon";
import { rt } from "../../lists/hookRuntime";
import { group } from "../dup.testSupport";
import { Lightbox } from "./Lightbox";
import type { Picture } from "./useImageUrl";
import { ZoomView } from "./ZoomView";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("../../lists/hookRuntime")).rt.hooks,
}));
vi.mock("../../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));

type Props = {
  children?: ReactNode;
  onKeyDown?: (e: object) => void;
  onClose?: () => void;
  onClick?: () => void;
  onBackground?: () => void;
  onError?: () => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const text = (node: ReactNode): string =>
  elements(node)
    .flatMap((e) => [e.props.children].flat())
    .filter((c) => typeof c === "string")
    .join("|");

const onStep = vi.fn();
const onClose = vi.fn();
const READY: Picture = { state: "ready", url: "blob:1" };
let shown: ReactElement<Props>;

function render(picture: Picture, name = "a.jpg") {
  rt.state.at = 0;
  shown = Lightbox({
    group: group("a", 1, { name }),
    picture,
    position: 1234,
    total: 5678,
    onStep,
    onClose,
  }) as ReactElement<Props>;
  // No DOM in the tests: the layout effect finds no dialog element and does nothing.
  for (const run of rt.state.queue.splice(0)) run();
}
const find = (type: unknown) => elements(shown).filter((e) => e.type === type);

beforeEach(() => {
  rt.state.slots = [];
  vi.clearAllMocks();
  vi.stubGlobal("document", { activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());
const labels = () =>
  find("button").map((b) => [b.props.children].flat().find((c) => typeof c === "string"));

describe("Lightbox", () => {
  it("is a native modal dialog that Escape closes", () => {
    render(READY);
    expect(shown.type).toBe("dialog");
    shown.props.onClose!();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("steps the groups on the arrows, not mirrored", () => {
    render(READY);
    const right = { key: "ArrowRight", preventDefault: vi.fn() };
    shown.props.onKeyDown!(right);
    expect(onStep).toHaveBeenLastCalledWith(1);
    expect(right.preventDefault).toHaveBeenCalled();
    const left = { key: "ArrowLeft", preventDefault: vi.fn() };
    shown.props.onKeyDown!(left);
    expect(onStep).toHaveBeenLastCalledWith(-1);
    expect(left.preventDefault).toHaveBeenCalled();
    shown.props.onKeyDown!({ key: "Enter", preventDefault: vi.fn() });
    expect(onStep).toHaveBeenCalledTimes(2);
    // Alt+arrow goes through the history and the like: only a plain arrow steps.
    for (const held of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
      const chord = { key: "ArrowRight", [held]: true, preventDefault: vi.fn() };
      shown.props.onKeyDown!(chord);
      expect(chord.preventDefault).not.toHaveBeenCalled();
    }
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("zooms the picture and closes on a click on the background", () => {
    render(READY);
    const [zoom] = find(ZoomView);
    expect(zoom.props.onBackground).toBe(onClose);
    expect(find(ItemIcon)).toEqual([]);
  });

  it("shows the icon and the name while there is no picture", () => {
    for (const picture of [{ state: "loading" }, { state: "none" }] as Picture[]) {
      render(picture);
      expect(find(ZoomView)).toEqual([]);
      expect(find(ItemIcon)).toHaveLength(1);
      expect(text(shown)).toContain("a.jpg");
      // The focus may be on any of them: none goes while the next picture loads or fails.
      expect(labels()).toEqual(["dup.view.fit", "dup.view.actual", "dialog.close"]);
    }
  });

  it("shows the icon of a picture the webview cannot decode, and the next one again", () => {
    render(READY);
    find(ZoomView)[0].props.onError!();
    render(READY);
    expect(find(ZoomView)).toEqual([]);
    expect(find(ItemIcon)).toHaveLength(1);
    render({ state: "ready", url: "blob:2" }, "b.jpg");
    expect(find(ZoomView)).toHaveLength(1);
  });

  it("says which picture of how many it is", () => {
    render(READY);
    expect(text(shown)).toContain('dup.view.position {"n":"1,234","total":"5,678"}');
  });
});

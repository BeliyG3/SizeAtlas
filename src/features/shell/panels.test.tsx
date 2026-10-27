import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MenuChoice } from "../menu/MenuChoice";
import { ViewItems } from "../menubar/ViewItems";
import { SplitPane } from "./SplitPane";
import { Toolbar } from "./Toolbar";
import { Workspace } from "./Workspace";

const settings = { showDrives: true, showChart: true, showCity: false, setShowCity: vi.fn() };
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../settings/react", () => ({ useSettings: () => settings }));

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element of the tree, depth first, through children and the panes of a split. */
function elements(node: unknown): ReactElement<Props>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const el = node as ReactElement<Props>;
  const { children, first, second } = el.props;
  return [el, ...elements(children), ...elements(first), ...elements(second)];
}

beforeEach(() => {
  settings.showCity = false;
  vi.clearAllMocks();
});

describe("the 3D city panel", () => {
  it("is a check item of View that toggles it", () => {
    const item = () =>
      elements(ViewItems()).find(
        (el) => el.type === MenuChoice && el.props.label === "menubar.city",
      )!;
    expect(item().props.checked).toBe(false);
    (item().props.onPick as () => void)();
    expect(settings.setShowCity).toHaveBeenCalledWith(true);
    settings.showCity = true;
    expect(item().props.checked).toBe(true);
    (item().props.onPick as () => void)();
    expect(settings.setShowCity).toHaveBeenLastCalledWith(false);
  });

  it("is a toggle button of the toolbar that says whether it is shown", () => {
    const none = () => {};
    const button = () =>
      elements(
        Toolbar({
          canBack: false,
          canForward: false,
          onBack: none,
          onForward: none,
          sources: null,
          pending: null,
          selectedRoot: null,
          inTree: new Set(),
          waiting: new Set(),
          scanning: false,
          onPick: none,
          onOpen: none,
          onScan: none,
          onChooseFolder: none,
          onCancel: none,
          onForget: none,
          mode: "all",
          onMode: none,
          query: "",
          onQuery: none,
          onSearch: none,
          searchRef: { current: null },
        }),
      ).find((el) => el.props.title === "toolbar.city")!;
    expect(button().props["aria-pressed"]).toBe(false);
    (button().props.onClick as () => void)();
    expect(settings.setShowCity).toHaveBeenCalledWith(true);
    settings.showCity = true;
    expect(button().props["aria-pressed"]).toBe(true);
  });

  it("is the pane right of the content, collapsed while off", () => {
    const pane = () =>
      elements(
        Workspace({
          tree: "tree",
          drives: "drives",
          content: "content",
          city: "city",
          drivesWidth: 0,
        }),
      ).find((el) => el.type === SplitPane && el.props.storageKey === "sizeatlas.split.city")!;
    expect(pane().props).toMatchObject({
      direction: "row",
      sized: "second",
      first: "content",
      second: "city",
      collapse: "second",
    });
    settings.showCity = true;
    expect(pane().props.collapse).toBeUndefined();
  });
});

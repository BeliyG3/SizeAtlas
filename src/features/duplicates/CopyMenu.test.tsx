import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { copy } from "./dup.testSupport";
import { CopyMenu } from "./CopyMenu";

vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));
vi.mock("../../api/client", () => ({
  api: {
    copyText: vi.fn(),
    openItem: vi.fn(),
    openWith: vi.fn(),
    reveal: vi.fn(),
    showProperties: vi.fn(),
  },
}));

type Item = { role?: string; disabled?: boolean; title?: string; children?: ReactNode };
function elements(node: ReactNode): ReactElement<Item>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Item>;
  return [element, ...elements(element.props.children)];
}
/** The menu items: their label key, whether they are enabled and their tooltip. */
const items = (tree: ReactNode) =>
  elements(tree)
    .filter((e) => e.props.role === "menuitem")
    .map((e) => ({
      label: [e.props.children].flat(2).find((c) => typeof c === "string"),
      disabled: e.props.disabled,
      title: e.props.title,
      click: (e.props as { onClick: () => void }).onClick,
    }));

const onTrash = vi.fn();
const onClose = vi.fn();
const menu = (count: number, canTrash: boolean, trashNote: string | null, Menu = CopyMenu) =>
  Menu({
    copies: Array.from({ length: count }, (_, i) => copy(i + 1)),
    x: 0,
    y: 0,
    canTrash,
    trashNote,
    onTrash,
    onClose,
    onFail: vi.fn(),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.copyText).mockResolvedValue();
});

describe("CopyMenu", () => {
  it("offers the trash, never deleting for good", () => {
    const labels = items(menu(1, true, null)).map((i) => i.label);
    expect(labels).toContain("menu.trash");
    expect(labels).not.toContain("menu.purge");
    expect(labels.some((l) => l?.startsWith("menu.purge"))).toBe(false);
  });

  it("disables the trash with its reason as the tooltip", () => {
    const trash = items(menu(2, false, "dup.lastCopy")).find((i) => i.label === "menu.trashMany");
    expect(trash).toMatchObject({ disabled: true, title: "dup.lastCopy" });
  });

  it("copies the paths of several copies, and offers nothing that needs one", () => {
    const shown = items(menu(2, true, null));
    expect(shown.map((i) => i.label)).not.toContain("menu.open");
    shown.find((i) => i.label === "menu.copyPaths")!.click();
    expect(vi.mocked(api.copyText).mock.calls[0][0]).toMatch(/^C:\\f1\.jpg\r?\nC:\\f2\.jpg$/);
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the copies to the trash when it is enabled", () => {
    items(menu(1, true, null))
      .find((i) => i.label === "menu.trash")!
      .click();
    expect(onTrash).toHaveBeenCalledOnce();
  });

  it("offers Open with… for one copy on Windows only", async () => {
    const labels = (shown: ReturnType<typeof items>) => shown.map((i) => i.label);
    expect(labels(items(menu(1, true, null)))).not.toContain("menu.openWith");

    vi.stubGlobal("navigator", { userAgent: "Windows" });
    vi.resetModules();
    try {
      const { CopyMenu: WindowsMenu } = await import("./CopyMenu");
      // resetModules re-runs the mock factory: the menu calls this api, not the imported one
      const { api: windowsApi } = await import("../../api/client");
      const one = items(menu(1, true, null, WindowsMenu));
      const at = labels(one).indexOf("menu.open");
      expect(labels(one)[at + 1]).toBe("menu.openWith");
      vi.mocked(windowsApi.openWith).mockResolvedValue();
      one[at + 1].click();
      expect(windowsApi.openWith).toHaveBeenCalledWith(1, copy(1).refs[0].id);
      expect(labels(items(menu(2, true, null, WindowsMenu)))).not.toContain("menu.openWith");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

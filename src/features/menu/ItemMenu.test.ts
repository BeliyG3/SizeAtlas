import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { ItemMenu, menuIds } from "./ItemMenu";

vi.mock("../../api/client", () => ({ api: { copyText: vi.fn(() => Promise.resolve()) } }));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

/** The menu items of a rendered menu, depth first. */
function menuItems(node: ReactNode): ReactElement<{ onClick: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(menuItems);
  if (!isValidElement<{ role?: string; children?: ReactNode }>(node)) return [];
  if (node.props.role === "menuitem") return [node as ReactElement<{ onClick: () => void }>];
  return menuItems(node.props.children);
}

describe("item menu", () => {
  it("acts on the marked rows it opened on, else on its one item", () => {
    expect(menuIds({ id: 1, isDir: false, lossy: false, x: 0, y: 0 })).toEqual([1]);
    expect(menuIds({ id: 1, isDir: false, lossy: false, marked: [1, 2], x: 0, y: 0 })).toEqual([
      1, 2,
    ]);
  });

  it("gives no id of a deleted folder: only its path can be copied", () => {
    const gone = {
      id: 4294967295,
      isDir: true,
      lossy: false,
      deletedPath: "C:\\a\\gone",
      x: 0,
      y: 0,
    };
    expect(menuIds(gone)).toEqual([]);
  });

  it("copies the path of a deleted folder through the backend, then closes", () => {
    const onClose = vi.fn();
    const onFail = vi.fn();
    const deletedPath = "C:\\a\\gone";
    const menu = ItemMenu({
      target: { id: 4294967295, isDir: true, lossy: false, deletedPath, x: 0, y: 0 },
      generation: 1,
      canTrash: false,
      trashNote: null,
      canScan: false,
      canRefresh: false,
      onRefresh: vi.fn(),
      onScanFolder: vi.fn(),
      onTrash: vi.fn(),
      onClose,
      onFail,
    });
    const items = menuItems(menu);
    expect(items).toHaveLength(1);
    // A webview without `navigator.clipboard` (WebKitGTK) must not matter.
    items[0].props.onClick();
    expect(api.copyText).toHaveBeenCalledWith(deletedPath);
    expect(onClose).toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });
});

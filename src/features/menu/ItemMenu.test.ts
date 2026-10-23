import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { ItemMenu, menuIds } from "./ItemMenu";

vi.mock("../../api/client", () => ({ api: { copyText: vi.fn(() => Promise.resolve()) } }));
vi.mock("../../i18n/react", () => ({ useT: () => ({ t: (key: string) => key, lang: "en" }) }));

type MenuItem = ReactElement<{
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode[];
}>;

/** The menu items of a rendered menu, depth first. */
function menuItems(node: ReactNode): MenuItem[] {
  if (Array.isArray(node)) return node.flatMap(menuItems);
  if (!isValidElement<{ role?: string; children?: ReactNode }>(node)) return [];
  if (node.props.role === "menuitem") return [node as MenuItem];
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

  type Target = Parameters<typeof ItemMenu>[0]["target"];
  const onTrash = vi.fn();
  const onPurge = vi.fn();
  const menuOf = (target: Partial<Target>, canTrash = true) =>
    menuItems(
      ItemMenu({
        target: { id: 5, isDir: true, lossy: false, x: 0, y: 0, ...target },
        generation: 1,
        canTrash,
        trashNote: canTrash ? null : "trash.busy",
        canScan: true,
        canRefresh: true,
        onRefresh: vi.fn(),
        onScanFolder: vi.fn(),
        onTrash,
        onPurge,
        onClose: vi.fn(),
        onFail: vi.fn(),
      }),
    );
  const labels = (items: MenuItem[]) => items.map((i) => i.props.children[1]);
  const itemOf = (items: MenuItem[], label: string) =>
    items.find((i) => i.props.children[1] === label);

  describe("Delete permanently", () => {
    it("is offered, in red, only for the rows of the clean-up lists", () => {
      const purge = itemOf(menuOf({ cleanup: true }), "menu.purge");
      expect(purge?.props.className).toBe("danger");
      expect(itemOf(menuOf({}), "menu.purge")).toBeUndefined();
      expect(labels(menuOf({ marked: [5, 6] }))).not.toContain("menu.purgeMany");
    });

    it("asks to delete the items of the menu for good, never to move them", () => {
      onTrash.mockReset();
      onPurge.mockReset();
      itemOf(menuOf({ cleanup: true, marked: [5, 6] }), "menu.purgeMany")!.props.onClick();
      expect(onPurge).toHaveBeenCalledWith(1, [5, 6]);
      expect(onTrash).not.toHaveBeenCalled();
    });

    it("is not available while another request removes items, and says why", () => {
      const purge = itemOf(menuOf({ cleanup: true }, false), "menu.purge")!;
      expect(purge.props.disabled).toBe(true);
      expect(purge.props.title).toBe("trash.busy");
    });

    it("leaves the trash of a clean-up row to the clean-up checks, of other rows as before", () => {
      onTrash.mockReset();
      itemOf(menuOf({ cleanup: true }), "menu.trash")!.props.onClick();
      itemOf(menuOf({}), "menu.trash")!.props.onClick();
      expect(onTrash.mock.calls).toEqual([
        [1, [5], true],
        [1, [5], false],
      ]);
    });
  });

  describe("Copy clean-up command", () => {
    it("is offered for a clean-up row with a command, and copies it through the backend", () => {
      const items = menuOf({ cleanup: true, command: "npm cache clean --force" });
      expect(labels(items)).toContain("cleanup.copyCommand");
      const at = labels(items).indexOf("cleanup.copyCommand");
      items[at].props.onClick();
      expect(api.copyText).toHaveBeenLastCalledWith("npm cache clean --force");
    });

    it("says under the item, in plain sight, that the command deletes at once", () => {
      const item = menuOf({ cleanup: true, command: "x" }).find(
        (i) => i.props.children[1] === "cleanup.copyCommand",
      );
      const note = item!.props.children[2] as ReactElement<{ children: string }>;
      expect(note.props.children).toBe("cleanup.commandNote");
    });

    it("is offered for a row whose name could not be read exactly: the command needs no path", () => {
      const items = menuOf({ cleanup: true, command: "x", lossy: true });
      const item = items.find((i) => i.props.children[1] === "cleanup.copyCommand")!;
      expect((item.props as { disabled?: boolean }).disabled).toBe(false);
      const copy = items.find((i) => i.props.children[1] === "menu.copyPath")!;
      expect((copy.props as { disabled?: boolean }).disabled).toBe(true);
    });

    it("is not offered without a command, nor for several marked rows", () => {
      expect(labels(menuOf({ cleanup: true }))).not.toContain("cleanup.copyCommand");
      expect(labels(menuOf({}))).not.toContain("cleanup.copyCommand");
      const several = menuOf({ cleanup: true, command: "x", marked: [5, 6] });
      expect(labels(several)).not.toContain("cleanup.copyCommand");
    });
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
      onPurge: vi.fn(),
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

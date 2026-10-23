import { Fragment, type ReactNode } from "react";
import { api } from "../../api/client";
import { ROOT_ID } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { Menu } from "./Menu";

/** Only Windows has a Properties dialog to show. */
const HAS_PROPERTIES = /Windows/i.test(navigator.userAgent);

/** What a context menu acts on and where it opens (viewport coordinates). */
export interface MenuTarget {
  id: number;
  /** A folder: the menu offers to refresh it. */
  isDir: boolean;
  lossy: boolean;
  /** The marked items when the menu opened on one of several marked rows (`id` among them). */
  marked?: readonly number[];
  /** A deleted folder of "Grew most": its full path. Its id is not a node: only the path is copied. */
  deletedPath?: string;
  /**
   * The row is one of "Can be cleaned" or "Check before deleting": its trash is checked again as
   * a clean-up row, and it can be deleted for good. The tree and the charts never set it.
   */
  cleanup?: boolean;
  /** The clean-up command of the tool that owns the row (a package manager's own cache clean). */
  command?: string;
  x: number;
  y: number;
}

/** The items a menu acts on: the marked rows it opened on, else its one item; none for a deleted folder. */
export function menuIds(target: MenuTarget): readonly number[] {
  if (target.deletedPath !== undefined) return [];
  return target.marked && target.marked.length > 1 ? target.marked : [target.id];
}

interface Props {
  target: MenuTarget;
  generation: number;
  /** No scan still lists the items and no trash or delete runs: they can go (also for good). */
  canTrash: boolean;
  /** Why they cannot, shown as the tooltip of the disabled items. */
  trashNote: string | null;
  canScan: boolean;
  canRefresh: boolean;
  /** Why refresh is not available, shown as its tooltip. */
  refreshNote?: string | null;
  /** Queues a refresh of folder `id`. */
  onRefresh: (generation: number, id: number) => void;
  /** Queues a scan of folder `id` as a root of its own. */
  onScanFolder: (generation: number, id: number) => void;
  /** Asks to move `ids` to the trash; `cleanup`: they are rows of a clean-up list. */
  onTrash: (generation: number, ids: readonly number[], cleanup: boolean) => void;
  /** Asks to delete `ids`, rows of a clean-up list, for good. */
  onPurge: (generation: number, ids: readonly number[]) => void;
  onClose: () => void;
  onFail: (e: unknown) => void;
}

/** Context menu of a file or folder, or of several marked rows. */
export function ItemMenu({
  target,
  generation,
  canTrash,
  trashNote,
  canScan,
  canRefresh,
  refreshNote = null,
  onRefresh,
  onScanFolder,
  onTrash,
  onPurge,
  onClose,
  onFail,
}: Props) {
  const { t, lang } = useT();
  const { command } = target;
  const cleanup = target.cleanup ?? false;
  const ids = menuIds(target);
  const many = ids.length > 1;
  const one = !many;
  /** Calls a command on the one item the menu opened on. */
  const onItem = (call: (generation: number, id: number) => Promise<void>) =>
    void call(generation, target.id).catch(onFail);
  // One item whose name could not be read exactly has no real path; the backend checks several.
  const blocked = one && target.lossy;
  const item = (
    icon: IconName,
    label: string,
    run: () => void,
    enabled = true,
    note: string | null = null,
    /** Shown under the label; it does not depend on the path, so a lossy name does not block it. */
    sub: string | null = null,
    /** It cannot be taken back: red. */
    danger = false,
  ) => {
    // The one item with a line under it, the clean-up command, does not depend on the path.
    const needsPath = blocked && sub === null;
    return (
      <button
        key={label}
        role="menuitem"
        className={danger ? "danger" : undefined}
        disabled={needsPath || !enabled}
        title={needsPath ? t("menu.lossy") : (note ?? undefined)}
        onClick={() => {
          run();
          onClose();
        }}
      >
        <Icon name={icon} />
        {label}
        {sub !== null && <small className="menu-sub">{sub}</small>}
      </button>
    );
  };
  const counted = { count: ids.length, items: formatCount(ids.length, lang) };
  // Groups of items, set apart by separators; a group without items leaves no separator.
  const groups: (ReactNode[] | false)[] = [
    one && [
      item("open", t("menu.open"), () => onItem(api.openItem)),
      item("reveal", t("menu.reveal"), () => onItem(api.reveal)),
      HAS_PROPERTIES && item("properties", t("menu.properties"), () => onItem(api.showProperties)),
    ],
    one &&
      target.isDir && [
        item(
          "refresh",
          t("menu.refresh"),
          () => onRefresh(generation, target.id),
          canRefresh,
          refreshNote,
        ),
        target.id !== ROOT_ID &&
          item(
            "scan-folder",
            t("menu.scanFolder"),
            () => onScanFolder(generation, target.id),
            canScan,
          ),
      ],
    [
      item("copy", t(many ? "menu.copyPaths" : "menu.copyPath"), () => {
        void api.copyPaths(generation, [...ids]).catch(onFail);
      }),
      // The command deletes at once, without the trash: the user runs it, SizeAtlas only copies it.
      one &&
        command !== undefined &&
        item(
          "copy",
          t("cleanup.copyCommand"),
          () => void api.copyText(command).catch(onFail),
          true,
          null,
          t("cleanup.commandNote"),
        ),
    ],
    [
      item(
        "trash",
        many ? t("menu.trashMany", counted) : t("menu.trash"),
        () => onTrash(generation, ids, cleanup),
        canTrash,
        trashNote,
      ),
      cleanup &&
        item(
          "trash",
          many ? t("menu.purgeMany", counted) : t("menu.purge"),
          () => onPurge(generation, ids),
          canTrash,
          trashNote,
          null,
          true,
        ),
    ],
  ];
  const { deletedPath } = target;
  const shown =
    deletedPath === undefined
      ? groups.filter((group) => group !== false)
      : [
          [
            // Not `navigator.clipboard`: WebKitGTK has none.
            item("copy", t("menu.copyPath"), () => void api.copyText(deletedPath).catch(onFail)),
          ],
        ];
  return (
    <Menu x={target.x} y={target.y} onClose={onClose}>
      {shown.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <div role="separator" />}
          {group}
        </Fragment>
      ))}
    </Menu>
  );
}

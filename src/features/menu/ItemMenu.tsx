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
  /** No scan still lists the items and no trash runs: they can go to the trash. */
  canTrash: boolean;
  /** Why they cannot, shown as the tooltip of the disabled item. */
  trashNote: string | null;
  canScan: boolean;
  canRefresh: boolean;
  /** Why refresh is not available, shown as its tooltip. */
  refreshNote?: string | null;
  /** Queues a refresh of folder `id`. */
  onRefresh: (generation: number, id: number) => void;
  /** Queues a scan of folder `id` as a root of its own. */
  onScanFolder: (generation: number, id: number) => void;
  /** Asks to move `ids` to the trash. */
  onTrash: (generation: number, ids: readonly number[]) => void;
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
  onClose,
  onFail,
}: Props) {
  const { t, lang } = useT();
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
  ) => (
    <button
      key={icon}
      role="menuitem"
      disabled={blocked || !enabled}
      title={blocked ? t("menu.lossy") : (note ?? undefined)}
      onClick={() => {
        run();
        onClose();
      }}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
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
    ],
    [
      item(
        "trash",
        many
          ? t("menu.trashMany", { count: ids.length, items: formatCount(ids.length, lang) })
          : t("menu.trash"),
        () => onTrash(generation, ids),
        canTrash,
        trashNote,
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

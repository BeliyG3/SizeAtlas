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
  x: number;
  y: number;
}

interface Props {
  target: MenuTarget;
  generation: number;
  /** The root is not being scanned and no trash runs: its items can go to the trash. */
  canTrash: boolean;
  canScan: boolean;
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
  canScan,
  onRefresh,
  onScanFolder,
  onTrash,
  onClose,
  onFail,
}: Props) {
  const { t, lang } = useT();
  const ids = target.marked && target.marked.length > 1 ? target.marked : [target.id];
  const many = ids.length > 1;
  const one = !many;
  /** Calls a command on the one item the menu opened on. */
  const onItem = (call: (generation: number, id: number) => Promise<void>) =>
    void call(generation, target.id).catch(onFail);
  // One item whose name could not be read exactly has no real path; the backend checks several.
  const blocked = one && target.lossy;
  const item = (icon: IconName, label: string, run: () => void, enabled = true) => (
    <button
      key={icon}
      role="menuitem"
      disabled={blocked || !enabled}
      title={blocked ? t("menu.lossy") : undefined}
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
        item("refresh", t("menu.refresh"), () => onRefresh(generation, target.id), canScan),
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
      ),
    ],
  ];
  const shown = groups.filter((group) => group !== false);
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

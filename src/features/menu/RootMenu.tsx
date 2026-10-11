import { api } from "../../api/client";
import { ROOT_ID, type RootStatus } from "../../api/types";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "./Menu";

/** A root row the menu acts on, and where it opens (viewport coordinates). */
export interface RootMenuTarget {
  root: string;
  /** Null for a root that has no tree yet. */
  generation: number | null;
  status: RootStatus;
  x: number;
  y: number;
}

interface Props {
  target: RootMenuTarget;
  canRescan: boolean;
  onRescan: (root: string) => void;
  /** Removes the root from the tree and stops its scan; its saved scan stays. */
  onCloseRoot: (root: string) => void;
  /** Deletes the saved scan and closes the root. */
  onForget: (root: string) => void;
  onCancelScan: (root: string) => void;
  onClose: () => void;
  onFail: (e: unknown) => void;
}

/** Context menu of a root row. */
export function RootMenu({
  target,
  canRescan,
  onRescan,
  onCloseRoot,
  onForget,
  onCancelScan,
  onClose,
  onFail,
}: Props) {
  const { t } = useT();
  const { root, generation, status } = target;
  const run = (action: () => void) => {
    action();
    onClose();
  };
  const onTree = (action: (generation: number, id: number) => Promise<void>) =>
    run(() => {
      if (generation !== null) void action(generation, ROOT_ID).catch(onFail);
    });
  return (
    <Menu x={target.x} y={target.y} onClose={onClose}>
      <button
        role="menuitem"
        disabled={status !== "open" || !canRescan}
        onClick={() => run(() => onRescan(root))}
      >
        <Icon name="refresh" />
        {t("menu.rescan")}
      </button>
      <button
        role="menuitem"
        disabled={status === "open"}
        onClick={() => run(() => onCancelScan(root))}
      >
        <Icon name="cancel" />
        {t("menu.cancelScan")}
      </button>
      <button role="menuitem" onClick={() => run(() => onCloseRoot(root))}>
        {t("menu.close")}
      </button>
      <button role="menuitem" onClick={() => run(() => onForget(root))}>
        <Icon name="forget" />
        {t("menu.forget")}
      </button>
      <div role="separator" />
      <button role="menuitem" disabled={generation === null} onClick={() => onTree(api.reveal)}>
        <Icon name="reveal" />
        {t("menu.reveal")}
      </button>
      <button
        role="menuitem"
        disabled={generation === null}
        onClick={() => onTree((g, id) => api.copyPaths(g, [id]))}
      >
        <Icon name="copy" />
        {t("menu.copyPath")}
      </button>
    </Menu>
  );
}

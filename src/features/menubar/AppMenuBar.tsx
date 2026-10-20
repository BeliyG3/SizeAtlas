import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n/react";
import type { Separator } from "../export/csv";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { MenuChoice } from "../menu/MenuChoice";
import { SubMenu } from "../menu/SubMenu";
import { REPOSITORY } from "../update/github";
import type { UpdateCheck } from "../update/useUpdateCheck";
import { AboutDialog } from "./AboutDialog";
import { LanguageButton } from "./LanguageButton";
import { MenuBar, type BarMenu } from "./MenuBar";
import { ViewItems } from "./ViewItems";

interface Props {
  /** Scan › Scan: the source picked on the toolbar; null if none is picked or it is queued. */
  scanTarget: string | null;
  /** Scan › Rescan: the root of the selected folder; null if there is none or it is queued. */
  rescanTarget: string | null;
  /** Scan › Refresh folder: refreshes the current folder; null without one. */
  onRefresh: (() => void) | null;
  /** The current folder is the root: F5 scans it again, and the item says so. */
  refreshIsRescan: boolean;
  /** Why F5 is not available, shown as its tooltip. */
  refreshNote?: string | null;
  /** Scan › Move to the trash: the marked rows, else the selected item; null when none or busy. */
  onTrash: (() => void) | null;
  /** Why Scan › Move to the trash is unavailable, for its tooltip. */
  trashNote: string | null;
  /** A scan runs: Scan › Cancel stops it. */
  scanning: boolean;
  /** Scan › Forget: the picked source if it has a saved scan. */
  forgetTarget: string | null;
  onChooseFolder: () => void;
  /** File › Export table: writes the table with `separator`; null when no root is open. */
  onExport: ((separator: Separator) => void) | null;
  /** The separator of the last export, which Ctrl+E uses. */
  exportSeparator: Separator;
  /** Queues a scan. */
  onScan: (path: string) => void;
  onCancel: () => void;
  /** Deletes the saved scan of `root`, closing it if it is open. */
  onForget: (root: string) => void;
  onError: (e: unknown) => void;
  /** Help › Check for updates and its automatic check. */
  update: UpdateCheck;
}

/** File, Scan, View and Help above the toolbar. */
export function AppMenuBar({
  scanTarget,
  rescanTarget,
  onRefresh,
  refreshIsRescan,
  refreshNote,
  onTrash,
  trashNote,
  scanning,
  forgetTarget,
  onChooseFolder,
  onExport,
  exportSeparator,
  onScan,
  onCancel,
  onForget,
  onError,
  update,
}: Props) {
  const { t } = useT();
  const [about, setAbout] = useState(false);
  /** A menu item; `run` null disables it; `keys` is its shortcut, shown on the right. */
  const item = (
    icon: IconName,
    label: string,
    run: (() => void) | null,
    keys?: string,
    note?: string | null,
  ) => (
    <button
      role="menuitem"
      className={keys ? "keyed" : undefined}
      disabled={run === null}
      title={note ?? undefined}
      onClick={run ?? undefined}
    >
      <Icon name={icon} />
      {label}
      {keys && <span className="key">{keys}</span>}
    </button>
  );
  const on = (target: string | null, action: (path: string) => void) =>
    target === null ? null : () => action(target);
  const exportWith = (separator: Separator) =>
    onExport === null ? null : () => onExport(separator);
  const exportKey = (separator: Separator) =>
    separator === exportSeparator ? "Ctrl+E" : undefined;
  // The same path as the window's close button: Saving… while a scan is written.
  const exit = () => {
    try {
      getCurrentWindow().close().catch(onError);
    } catch (e) {
      // Not running inside Tauri: getCurrentWindow throws without its internals.
      onError(e);
    }
  };
  const openRepository = () => void api.openUrl(REPOSITORY).catch(onError);
  const menus: BarMenu[] = [
    {
      id: "file",
      label: t("menubar.file"),
      items: (
        <>
          {item("choose-folder", t("toolbar.chooseFolder"), onChooseFolder)}
          <SubMenu label={t("export.menu")} icon="export">
            {item("export", t("export.csv"), exportWith(","), exportKey(","))}
            {item("export", t("export.excel"), exportWith(";"), exportKey(";"))}
          </SubMenu>
          <div role="separator" />
          {item("exit", t("menubar.exit"), exit)}
        </>
      ),
    },
    {
      id: "scan",
      label: t("menubar.scan"),
      items: (
        <>
          {item("scan", t("toolbar.scan"), on(scanTarget, onScan))}
          {item("refresh", t("toolbar.rescan"), on(rescanTarget, onScan), "Ctrl+F5")}
          {item(
            "refresh",
            t(refreshIsRescan ? "toolbar.rescan" : "menu.refresh"),
            onRefresh,
            "F5",
            refreshNote,
          )}
          {item("cancel", t("toolbar.cancel"), scanning ? onCancel : null)}
          {item("forget", t("toolbar.forget"), on(forgetTarget, onForget))}
          <div role="separator" />
          {item("trash", t("menu.trash"), onTrash, "Del", trashNote)}
        </>
      ),
    },
    { id: "view", label: t("menubar.view"), items: <ViewItems /> },
    {
      id: "help",
      label: t("menubar.help"),
      items: (
        <>
          {item("refresh", t("update.check"), update.checkNow)}
          <MenuChoice
            kind="check"
            checked={update.auto}
            label={t("update.auto")}
            onPick={() => update.setAuto(!update.auto)}
          />
          <div role="separator" />
          {item("open", t("menubar.github"), openRepository)}
          {item("info", t("menubar.about"), () => setAbout(true))}
        </>
      ),
    },
  ];
  return (
    <>
      <MenuBar label={t("menubar.label")} menus={menus} trailing={<LanguageButton />} />
      {about && <AboutDialog onClose={() => setAbout(false)} onOpenRepository={openRepository} />}
    </>
  );
}

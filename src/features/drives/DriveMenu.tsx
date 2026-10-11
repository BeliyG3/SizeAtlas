import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "../menu/Menu";
import type { DriveChoice } from "./choice";

interface Props {
  x: number;
  y: number;
  /** What opening the drive would ask (see `driveChoice`). */
  choice: DriveChoice;
  /** The drive has a saved scan or is open. */
  forgettable: boolean;
  onScan: () => void;
  onOpen: () => void;
  onForget: () => void;
  onClose: () => void;
}

/** Context menu of a drive row. */
export function DriveMenu({ x, y, choice, forgettable, onScan, onOpen, onForget, onClose }: Props) {
  const { t } = useT();
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <Menu x={x} y={y} onClose={onClose}>
      {/* A drive with a scan rescans; one whose scan runs or waits is not scanned again. */}
      <button role="menuitem" disabled={choice.kind === "select"} onClick={() => run(onScan)}>
        <Icon name={choice.kind === "open" ? "refresh" : "scan"} />
        {t(choice.kind === "open" ? "drives.rescan" : "toolbar.scan")}
      </button>
      <button role="menuitem" disabled={choice.kind === "scan"} onClick={() => run(onOpen)}>
        <Icon name="folder-open" />
        {t("toolbar.open")}
      </button>
      <button role="menuitem" disabled={!forgettable} onClick={() => run(onForget)}>
        <Icon name="forget" />
        {t("menu.forget")}
      </button>
    </Menu>
  );
}

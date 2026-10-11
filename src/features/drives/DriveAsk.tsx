import { formatDate } from "../../format";
import { useT } from "../../i18n/react";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import type { DriveChoice } from "./choice";

interface Props {
  mount: string;
  /** A network drive: the dialog warns that scanning can be slow. */
  network: boolean;
  /** Asked for a drive that is not being scanned (see `driveChoice`). */
  choice: Exclude<DriveChoice, { kind: "select" }>;
  onOpen: (mount: string) => void;
  onScan: (mount: string) => void;
  onClose: () => void;
}

/** Asks whether to scan a drive, or to open or rescan the scan it has. */
export function DriveAsk({ mount, network, choice, onOpen, onScan, onClose }: Props) {
  const { t, lang } = useT();
  const note = (question: string) =>
    network ? `${question}\n${t("drives.networkNote")}` : question;
  const scan = () => onScan(mount);
  if (choice.kind === "scan") {
    return (
      <ConfirmDialog
        message={note(t("drives.scanAsk", { drive: mount }))}
        actions={[{ label: t("toolbar.scan"), run: scan }]}
        onClose={onClose}
      />
    );
  }
  const date = formatDate(choice.scannedAt * 1000, lang);
  return (
    <ConfirmDialog
      message={note(t("drives.openAsk", { drive: mount, date }))}
      actions={[
        { label: t("toolbar.open"), run: () => onOpen(mount) },
        { label: t("drives.rescan"), run: scan },
      ]}
      onClose={onClose}
    />
  );
}

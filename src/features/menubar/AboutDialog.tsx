import { version } from "../../../package.json";
import { useT } from "../../i18n/react";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { displayVersion } from "./version";

/** Name, version and license of the app; nothing is fetched. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const message = [
    t("app.title"),
    t("about.version", { version: displayVersion(version) }),
    t("about.license"),
  ].join("\n");
  return (
    <ConfirmDialog
      message={message}
      actions={[]}
      cancelLabel={t("dialog.close")}
      onClose={onClose}
    />
  );
}

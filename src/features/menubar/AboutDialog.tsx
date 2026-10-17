import { version } from "../../../package.json";
import appIcon from "../../assets/app-icon-128.png";
import { useT } from "../../i18n/react";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { REPOSITORY } from "../update/github";
import { displayVersion } from "./version";

interface Props {
  onClose: () => void;
  /** Opens the project page in the browser. */
  onOpenRepository: () => void;
}

/** Name, version, license and author of the app, and a link to its page; nothing is fetched. */
export function AboutDialog({ onClose, onOpenRepository }: Props) {
  const { t } = useT();
  const lines = [
    t("app.title"),
    t("about.version", { version: displayVersion(version) }),
    t("about.license"),
    t("about.author"),
  ].join("\n");
  const message = (
    <>
      {lines}
      {"\n"}
      <a
        href={REPOSITORY}
        onClick={(e) => {
          // The page opens in the browser, never inside the app window.
          e.preventDefault();
          onOpenRepository();
        }}
      >
        {REPOSITORY.replace("https://", "")}
      </a>
    </>
  );
  return (
    <ConfirmDialog
      message={message}
      actions={[]}
      cancelLabel={t("dialog.close")}
      focusCancel
      onClose={onClose}
      icon={appIcon}
    />
  );
}

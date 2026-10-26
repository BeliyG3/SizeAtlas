import { api, isCmdError } from "../../api/client";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import type { AccessState } from "./accessState";
import { useRestartElevated } from "./elevation";

/** How to get access to unreadable folders on each platform. */
const HINT = {
  windows: "banner.hintWindows",
  mac: "banner.hintMac",
  other: "banner.hintOther",
} as const;

export interface AccessProps {
  count: number;
  /** The root the notice is about: the one rescanned after a restart. */
  root: string;
  state: AccessState;
  push: (text: string) => void;
  errorText: (e: unknown) => string;
  /** Lists the unreadable folders of `root`. */
  onShow: () => void;
}

/** The text about unreadable folders and the buttons to act on it: the body of the banner and of the popover of the chip. */
export function AccessInfo({ count, root, state, push, errorText, onShow }: AccessProps) {
  const { t, lang } = useT();
  const { os, elevated, fullDiskAccess } = state;
  const restart = useRestartElevated(root, push, errorText);

  /** The message of the system alone: the path of an `Io` error means nothing here. */
  const osText = (e: unknown) => (isCmdError(e) && e.code === "Io" ? e.osMessage : errorText(e));
  const openPrivacy = () => void api.openPrivacySettings().catch((e) => push(osText(e)));
  const canRestart = os === "windows" && elevated === false;
  // An administrator, or a Mac app with Full Disk Access, has nothing left to try: what stays
  // unread is closed to everyone.
  const hint =
    os === "windows" && elevated === true
      ? "banner.hintAdmin"
      : os === "mac" && fullDiskAccess === true
        ? "banner.hintMacFda"
        : HINT[os];

  return (
    <>
      <span>
        {t("banner.access", { count, folders: formatCount(count, lang) })} {t(hint)}
      </span>
      {canRestart && (
        <button disabled={restart.busy} onClick={restart.run}>
          {t("banner.restartElevated")}
        </button>
      )}
      {os === "mac" && fullDiskAccess !== true && (
        <button onClick={openPrivacy}>{t("banner.openPrivacy")}</button>
      )}
      <button onClick={onShow}>{t("banner.show")}</button>
    </>
  );
}

import { useEffect, useState } from "react";
import { api, isCmdError } from "../../api/client";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useElevated, useRestartElevated } from "./elevation";
import { platform } from "./platform";

/** How to get access to unreadable folders on each platform. */
const HINT = {
  windows: "banner.hintWindows",
  mac: "banner.hintMac",
  other: "banner.hintOther",
} as const;

/** Whether the app has Full Disk Access on macOS, asked once per mount; null until known. */
function useFullDiskAccess(ask: boolean): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    // Unknown counts as no access: the settings button stays.
    void api
      .hasFullDiskAccess()
      .catch(() => false)
      .then((value) => {
        if (live) setGranted(value);
      });
    return () => {
      live = false;
    };
  }, [ask]);
  return granted;
}

interface Props {
  count: number;
  /** The root the banner is about: the one rescanned after a restart. */
  root: string;
  push: (text: string) => void;
  errorText: (e: unknown) => string;
  /** Lists the unreadable folders of `root`. */
  onShow: () => void;
}

export function AccessBanner({ count, root, push, errorText, onShow }: Props) {
  const { t, lang } = useT();
  const os = platform();
  const elevated = useElevated(os === "windows");
  const fullDiskAccess = useFullDiskAccess(os === "mac");
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
    <p className="banner" role="note">
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
    </p>
  );
}

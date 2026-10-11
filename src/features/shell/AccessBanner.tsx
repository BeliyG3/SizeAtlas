import { useEffect, useRef, useState } from "react";
import { api, isCmdError } from "../../api/client";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";

type Platform = "windows" | "mac" | "other";

function platform(): Platform {
  const agent = navigator.userAgent;
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac/i.test(agent)) return "mac";
  return "other";
}

/** How to get access to unreadable folders on each platform. */
const HINT = {
  windows: "banner.hintWindows",
  mac: "banner.hintMac",
  other: "banner.hintOther",
} as const;

// Asked once per app instance: the rights of a process do not change while it runs.
let elevation: Promise<boolean> | null = null;

/** Whether the app runs as administrator; null until known. */
function useElevated(ask: boolean): boolean | null {
  const [elevated, setElevated] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    // Unknown counts as elevated: no button is better than one that cannot work.
    elevation ??= api.isElevated().catch(() => true);
    void elevation.then((value) => {
      if (live) setElevated(value);
    });
    return () => {
      live = false;
    };
  }, [ask]);
  return elevated;
}

interface Props {
  count: number;
  /** The root the banner is about: the one rescanned after a restart. */
  root: string;
  push: (text: string) => void;
  errorText: (e: unknown) => string;
}

export function AccessBanner({ count, root, push, errorText }: Props) {
  const { t, lang } = useT();
  const os = platform();
  const elevated = useElevated(os === "windows");
  const [busy, setBusy] = useState(false);
  // The banner can go away while the restart waits for the UAC prompt.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /** The message of the system alone: the path of an `Io` error means nothing here. */
  const osText = (e: unknown) => (isCmdError(e) && e.code === "Io" ? e.osMessage : errorText(e));
  // On success the window closes; the button stays off meanwhile.
  const restart = () => {
    setBusy(true);
    api.restartElevated([root]).catch((e: unknown) => {
      if (live.current) setBusy(false);
      if (isCmdError(e) && e.code === "Cancelled") push(t("banner.restartCancelled"));
      else push(t("banner.restartFailed", { message: osText(e) }));
    });
  };
  const openPrivacy = () => void api.openPrivacySettings().catch((e) => push(osText(e)));
  const canRestart = os === "windows" && elevated === false;
  // An administrator has nothing left to try: what stays unread is closed to everyone.
  const hint = os === "windows" && elevated === true ? "banner.hintAdmin" : HINT[os];

  return (
    <p className="banner" role="note">
      <span>
        {t("banner.access", { count, folders: formatCount(count, lang) })} {t(hint)}
      </span>
      {canRestart && (
        <button disabled={busy} onClick={restart}>
          {t("banner.restartElevated")}
        </button>
      )}
      {os === "mac" && <button onClick={openPrivacy}>{t("banner.openPrivacy")}</button>}
    </p>
  );
}

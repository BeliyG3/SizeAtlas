import { useEffect, useRef, useState } from "react";
import { version } from "../../../package.json";
import { useT } from "../../i18n/react";
import { parseShown, serializeShown } from "../../settings/settings";
import { readStored, useStored, writeStored } from "../../settings/storage";
import { isNewer } from "../menubar/version";
import { fetchLatest, type CheckResult, type Release } from "./github";
import { AUTO_KEY, DISMISSED_KEY, LAST_CHECK_KEY, isDue } from "./schedule";

// The automatic check of this app instance; StrictMode's second effect run reuses it.
let automatic: Promise<CheckResult> | null = null;

export interface UpdateCheck {
  /** A newer release whose banner was not closed; null if there is none. */
  offered: Release | null;
  /** Closes the banner for good for this version. */
  dismiss: () => void;
  /** Help › Check for updates: says the result in a toast unless a newer release is offered. */
  checkNow: () => void;
  /** Help › Check for updates automatically. */
  auto: boolean;
  setAuto: (on: boolean) => void;
}

/** Asks GitHub for a newer release: at the start at most once a day, and on request. */
export function useUpdateCheck(push: (text: string) => void): UpdateCheck {
  const { t } = useT();
  const [auto, setAuto] = useStored(AUTO_KEY, parseShown, serializeShown);
  const [release, setRelease] = useState<Release | null>(null);
  const [dismissed, setDismissed] = useState(() => readStored(DISMISSED_KEY));
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (!auto) return;
    if (automatic === null) {
      if (!isDue(readStored(LAST_CHECK_KEY), Date.now())) return;
      writeStored(LAST_CHECK_KEY, String(Date.now()));
      automatic = fetchLatest();
    }
    let current = true;
    // A failed automatic check stays silent: the next start tries again after a day.
    void automatic.then((result) => {
      if (current && result.ok && isNewer(result.release.version, version))
        setRelease(result.release);
    });
    return () => {
      current = false;
    };
  }, [auto]);

  const checkNow = () => {
    void fetchLatest().then((result) => {
      if (!live.current) return;
      if (!result.ok) push(t("update.failed", { reason: t(`update.reason.${result.reason}`) }));
      else if (!isNewer(result.release.version, version)) push(t("update.latest"));
      else {
        // Asked for: a banner closed before shows again.
        writeStored(DISMISSED_KEY, null);
        setDismissed(null);
        setRelease(result.release);
      }
    });
  };
  const dismiss = () => {
    if (!release) return;
    writeStored(DISMISSED_KEY, release.version);
    setDismissed(release.version);
  };
  const offered = release && release.version !== dismissed ? release : null;
  return { offered, dismiss, checkNow, auto, setAuto };
}

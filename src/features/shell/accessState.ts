import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useElevated } from "./elevation";
import { platform, type Platform } from "./platform";

/**
 * Whether there is something to do about unreadable folders besides listing them: restart as
 * administrator on Windows, allow Full Disk Access on a Mac. null while the answer is unknown.
 */
export function actionable(
  os: Platform,
  elevated: boolean | null,
  fullDiskAccess: boolean | null,
): boolean | null {
  if (os === "windows") return elevated === null ? null : !elevated;
  if (os === "mac") return fullDiskAccess === null ? null : !fullDiskAccess;
  return false;
}

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

export interface AccessState {
  os: Platform;
  elevated: boolean | null;
  fullDiskAccess: boolean | null;
  /** See `actionable`. */
  actionable: boolean | null;
}

/** What the access notices know about the rights of the app; shared by the banner and the chip. */
export function useAccessState(): AccessState {
  const os = platform();
  const elevated = useElevated(os === "windows");
  const fullDiskAccess = useFullDiskAccess(os === "mac");
  return { os, elevated, fullDiskAccess, actionable: actionable(os, elevated, fullDiskAccess) };
}

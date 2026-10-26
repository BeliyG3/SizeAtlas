import { useEffect, useRef, useState } from "react";
import { api, isCmdError } from "../../api/client";
import { useT } from "../../i18n/react";

// Asked once per app instance: the rights of a process do not change while it runs.
let elevation: Promise<boolean> | null = null;

/** Whether the app runs as administrator; null until known. */
export function useElevated(ask: boolean): boolean | null {
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

export interface Restart {
  busy: boolean;
  run: () => void;
}

/**
 * Restarts the app as administrator to rescan `root`, with the button off meanwhile (on success
 * the window closes). A refused prompt and a failure are told through `push`; `errorText` words
 * the failure.
 */
export function useRestartElevated(
  root: string,
  push: (text: string) => void,
  errorText: (e: unknown) => string,
): Restart {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  // The banner can go away while the restart waits for the UAC prompt.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const run = () => {
    setBusy(true);
    api.restartElevated([root]).catch((e: unknown) => {
      if (live.current) setBusy(false);
      if (isCmdError(e) && e.code === "Cancelled") push(t("banner.restartCancelled"));
      else {
        // The message of the system alone: the path of an `Io` error means nothing here.
        const message = isCmdError(e) && e.code === "Io" ? e.osMessage : errorText(e);
        push(t("banner.restartFailed", { message }));
      }
    });
  };
  return { busy, run };
}

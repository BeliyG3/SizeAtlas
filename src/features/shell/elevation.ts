import { useEffect, useState } from "react";
import { api } from "../../api/client";

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

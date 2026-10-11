import { useEffect, useRef, useState } from "react";
import { refreshInterval, waitForRefresh, type RefreshGroup } from "./cadence";

/** Coalesces live revisions; navigation and the completed tree remain immediately available. */
export function useLiveRevision(rev: number, liveScan: boolean, group: RefreshGroup): number {
  const [shown, setShown] = useState(rev);
  const last = useRef(-Infinity);
  useEffect(() => {
    if (last.current === -Infinity) last.current = performance.now();
    if (!liveScan || rev === shown) return;
    let live = true;
    const timer = setTimeout(
      () => {
        if (!live) return;
        last.current = performance.now();
        setShown(rev);
      },
      waitForRefresh({ last: last.current, interval: refreshInterval(group) }, performance.now()),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rev, shown, liveScan, group]);
  return liveScan ? shown : rev;
}

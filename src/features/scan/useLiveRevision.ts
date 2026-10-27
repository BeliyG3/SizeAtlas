import { useEffect, useRef, useState } from "react";
import { refreshInterval, waitForRefresh, type RefreshGroup } from "./cadence";

/**
 * Coalesces live revisions; navigation and the completed tree remain immediately available.
 * A new `scope` (another root) starts from its own revision, never the last scope's.
 */
export function useLiveRevision(
  rev: number,
  liveScan: boolean,
  group: RefreshGroup,
  scope?: unknown,
): number {
  const [state, setState] = useState({ scope, rev });
  const switched = !Object.is(state.scope, scope);
  // Adjusted while rendering, as React advises for state that follows a prop.
  if (switched) setState({ scope, rev });
  const shown = switched ? rev : state.rev;
  const last = useRef(-Infinity);
  useEffect(() => {
    if (last.current === -Infinity) last.current = performance.now();
    if (!liveScan || rev === shown) return;
    let live = true;
    const timer = setTimeout(
      () => {
        if (!live) return;
        last.current = performance.now();
        setState({ scope, rev });
      },
      waitForRefresh({ last: last.current, interval: refreshInterval(group) }, performance.now()),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rev, shown, liveScan, group, scope]);
  return liveScan ? shown : rev;
}

import { useCallback, useLayoutEffect, useRef } from "react";
import { beginRefresh, type RefreshGroup } from "./cadence";

/** Start on an accepted revision; mark ready before applying its complete batch of answers. */
export function useBatchCost(group: RefreshGroup, applied: unknown) {
  const ready = useRef<(() => void)[]>([]);
  useLayoutEffect(() => {
    for (const finish of ready.current.splice(0)) finish();
  }, [applied]);
  return useCallback(() => {
    const finish = beginRefresh(group);
    return () => ready.current.push(finish);
  }, [group]);
}

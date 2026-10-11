import type { Roots } from "../api/types";
import { waitForRefresh } from "../features/scan/cadence";

/** Queue changes land immediately; live revisions wait for their measured refresh interval. */
export function liveRoots(
  previous: Roots,
  next: Roots,
  now: number,
  interval: number,
  last: ReadonlyMap<number, number>,
): { roots: Roots; last: Map<number, number>; wait: number | null } {
  const times = new Map(last);
  let wait: number | null = null;
  const roots = next.roots.map((summary) => {
    const old = previous.roots.find((r) => r.generation === summary.generation);
    if (old?.scanning && summary.scanning && old.rev !== summary.rev) {
      const remaining = waitForRefresh(
        { last: times.get(summary.generation) ?? -Infinity, interval },
        now,
      );
      if (remaining > 0) {
        wait = Math.min(wait ?? Infinity, remaining);
        return old;
      }
    }
    if (!old || old.rev !== summary.rev || old.scanning !== summary.scanning) {
      times.set(summary.generation, now);
    }
    return summary;
  });
  for (const generation of times.keys()) {
    if (!roots.some((r) => r.generation === generation)) times.delete(generation);
  }
  return { roots: { roots, queue: next.queue }, last: times, wait };
}

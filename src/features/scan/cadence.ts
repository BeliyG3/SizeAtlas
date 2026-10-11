import type { ProfilerOnRenderCallback } from "react";

/** Measured refresh cost, with a minimum interval and a 10% update-work budget. */
export interface Cadence {
  minimum: number;
  interval: number;
  last: number;
}

export const newCadence = (minimum: number): Cadence => ({
  minimum,
  interval: minimum,
  last: -Infinity,
});

/** A costly update slows the next one; cheap updates recover gradually. Durations are ms. */
export function measured(cadence: Cadence, cost: number): Cadence {
  return { ...cadence, interval: Math.max(cadence.minimum, cost * 10, cadence.interval * 0.8) };
}

export const waitForRefresh = (cadence: Pick<Cadence, "last" | "interval">, now: number): number =>
  Math.max(0, cadence.last + cadence.interval - now);

export type RefreshGroup = "tree" | "charts";
const groups: Record<RefreshGroup, Cadence> = { tree: newCadence(2000), charts: newCadence(5000) };

export const refreshInterval = (group: RefreshGroup): number => groups[group].interval;
export function recordCost(group: RefreshGroup, cost: number) {
  groups[group] = measured(groups[group], cost);
}

/** React render cost where profiling is enabled; request and canvas costs are always measured. */
export const measureRender: ProfilerOnRenderCallback = (id, _phase, duration) => {
  recordCost(id === "charts" ? "charts" : "tree", duration);
};

/** Includes IPC, backend queries and parsing in the measured duration, including failures. */
export async function measuredRead<T>(group: RefreshGroup, read: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await read();
  } finally {
    recordCost(group, performance.now() - start);
  }
}

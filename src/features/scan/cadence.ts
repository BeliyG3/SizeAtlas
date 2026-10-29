/** Measured refresh cost, with a minimum interval and a 10% update-work budget. */
export interface Cadence {
  minimum: number;
  interval: number;
}

export const newCadence = (minimum: number): Cadence => ({
  minimum,
  interval: minimum,
});

/** A costly update slows the next one; cheap updates recover gradually. Durations are ms. */
export function measured(cadence: Cadence, cost: number): Cadence {
  return { ...cadence, interval: Math.max(cadence.minimum, cost * 10, cadence.interval * 0.8) };
}

export const waitForRefresh = (cadence: { last: number; interval: number }, now: number): number =>
  Math.max(0, cadence.last + cadence.interval - now);

/** The 3D city has its own group: its island costs far more than a chart and must not slow them. */
export type RefreshGroup = "tree" | "charts" | "city";
const groups: Record<RefreshGroup, Cadence> = {
  tree: newCadence(2000),
  charts: newCadence(5000),
  city: newCadence(5000),
};

export const refreshInterval = (group: RefreshGroup): number => groups[group].interval;
export function recordCost(group: RefreshGroup, cost: number) {
  groups[group] = measured(groups[group], cost);
}

/** One wall-time sample per accepted batch, completed after its state reaches the UI. */
export function beginRefresh(group: RefreshGroup): () => void {
  const start = performance.now();
  let complete = false;
  return () => {
    if (complete) return;
    complete = true;
    recordCost(group, performance.now() - start);
  };
}

/** Explorer's rule: the bar turns red when less than a tenth of the drive is free. */
const LOW_FREE = 0.1;

/** The used share (0..1) of a drive and whether it is nearly full; null when there is no size. */
export function driveFill(total: number, available: number): { used: number; low: boolean } | null {
  if (!(total > 0)) return null;
  const free = Math.min(Math.max(available / total, 0), 1);
  return { used: 1 - free, low: free < LOW_FREE };
}

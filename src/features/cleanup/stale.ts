const DAY_SECONDS = 24 * 60 * 60;

/** A scan (`scannedAt` in seconds) made more than a day before `nowMs`: its clean-up list may be out of date. */
export const staleScan = (scannedAt: number, nowMs: number): boolean =>
  scannedAt > 0 && nowMs / 1000 - scannedAt > DAY_SECONDS;

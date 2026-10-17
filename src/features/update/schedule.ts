/** Help › Check for updates automatically: "0" turns it off. */
export const AUTO_KEY = "sizeatlas.update.auto";
/** When the last automatic check started, in milliseconds since the epoch. */
export const LAST_CHECK_KEY = "sizeatlas.update.lastCheck";
/** The version whose banner was closed: it is not offered again. */
export const DISMISSED_KEY = "sizeatlas.update.dismissed";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a day has passed since the check stored as `last`; a time in the future counts as none. */
export function isDue(last: string | null, now: number): boolean {
  const at = last === null || last === "" ? Number.NaN : Number(last);
  return !(Number.isFinite(at) && at <= now && now - at < DAY_MS);
}

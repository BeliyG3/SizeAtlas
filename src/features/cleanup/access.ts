import type { InfoDto } from "../../api/cleanup";
import type { Platform } from "../shell/platform";

/**
 * The facts to show. An unreadable place says "needs administrator rights", which is true, and
 * can be acted on, only on Windows without them; for an administrator, on a Mac and elsewhere
 * the access banner has the right words.
 */
export function visibleInfo(
  info: readonly InfoDto[],
  os: Platform,
  elevated: boolean | null,
): InfoDto[] {
  const adminHelps = os === "windows" && elevated === false;
  return info.filter((line) => line.kind !== "noAccess" || adminHelps);
}

/** The facts offer the restart only where the access banner (shown when places are unreadable) does not. */
export const restartOffered = (
  os: Platform,
  elevated: boolean | null,
  accessErrors: number,
): boolean => os === "windows" && elevated === false && accessErrors === 0;

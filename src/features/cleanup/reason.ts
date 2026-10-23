import type { ReasonDto } from "../../api/types";
import type { Params } from "../../i18n";

type Translate = (key: string, params?: Params) => string;

/**
 * Why a clean-up row is offered, in words: the reason of its group and, for dependencies of a
 * project, whether a lock file lies next to them (so they can be installed again as they were).
 */
export function reasonText(reason: ReasonDto, t: Translate): string {
  const text = t(`reason.${reason.reason}`);
  if (reason.restorable === null) return text;
  return `${text} · ${t(reason.restorable ? "reason.lockFile" : "reason.noLockFile")}`;
}

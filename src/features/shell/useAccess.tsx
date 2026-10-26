import type { ReactNode } from "react";
import type { Summary } from "../../api/types";
import { AccessBanner } from "./AccessBanner";
import { AccessChip } from "./AccessChip";
import { useAccessDismissed } from "./accessDismissed";
import { useAccessState } from "./accessState";
import { useRestartElevated } from "./elevation";

interface Options {
  push: (text: string) => void;
  errorText: (e: unknown) => string;
  /** Lists the unreadable folders of the selected root. */
  onShow: () => void;
}

/**
 * The notices about unreadable folders of the selected root. The chip is there whenever there are
 * any. The banner only when there is something to do about them (see `actionable`), and not after
 * it was closed for this scan of this root; while that is unknown, the chip alone.
 */
export function useAccess(
  summary: Summary | null,
  options: Options,
): { banner: ReactNode; chip: ReactNode } {
  const state = useAccessState();
  const { isDismissed, dismiss } = useAccessDismissed();
  // One restart for the banner and the popover: pressed in one, it is busy in both.
  const restart = useRestartElevated(summary?.root ?? "", options.push, options.errorText);
  if (!summary || summary.accessErrors === 0) return { banner: null, chip: null };

  const info = { count: summary.accessErrors, state, restart, ...options };
  const banner = state.actionable === true && !isDismissed(summary.root, summary.scannedAt) && (
    <AccessBanner {...info} onDismiss={() => dismiss(summary.root, summary.scannedAt)} />
  );
  return { banner, chip: <AccessChip {...info} /> };
}

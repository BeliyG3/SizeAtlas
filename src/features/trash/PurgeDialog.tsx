import { useEffect, useState } from "react";
import type { TrashPreview } from "../../api/types";
import { formatCount, formatDate } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { purgeAgain, purgeMessage } from "./text";

/**
 * The second red button waits this long after it appears, about the system's double-click time:
 * the second click of a double click, or of a bouncing mouse button, on the first red button
 * must not answer the second question too.
 */
export const ARM_MS = 500;

interface Props {
  preview: TrashPreview;
  /** Called only from the red button of the second question. */
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The confirmation of deleting for good, in two questions: what goes and that it cannot be
 * undone, then once more how many items and how large. Both buttons are red, the focus is on
 * Cancel at each question, and neither a key held down nor a quick second click from the first
 * one can answer the second. Cancel or Escape at either question deletes nothing; Cancel works
 * at once.
 */
export function PurgeDialog({ preview, onConfirm, onClose }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const [again, setAgain] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!again) return;
    const timer = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(timer);
  }, [again]);
  const count = (n: number) => formatCount(n, lang);
  const message = again
    ? purgeAgain(preview, t, size, count)
    : purgeMessage(preview, t, size, (seconds) => formatDate(seconds * 1000, lang), count);
  const action = again
    ? { label: t("purge.confirmAgain"), run: onConfirm, danger: true, disabled: !armed }
    : { label: t("purge.confirm"), run: () => setAgain(true), danger: true, keepOpen: true };
  return (
    <ConfirmDialog
      message={message}
      actions={[action]}
      focusCancel
      question={again ? 2 : 1}
      ignoreHeldKeys
      onClose={onClose}
    />
  );
}

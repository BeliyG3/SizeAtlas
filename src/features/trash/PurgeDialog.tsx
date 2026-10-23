import { useState } from "react";
import type { TrashPreview } from "../../api/types";
import { formatCount, formatDate } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { purgeAgain, purgeMessage } from "./text";

interface Props {
  preview: TrashPreview;
  /** Called only from the red button of the second question. */
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The confirmation of deleting for good, in two questions: what goes and that it cannot be
 * undone, then once more how many items and how large. Both buttons are red, the focus is on
 * Cancel at each question, and a key held down from the first one cannot answer the second.
 * Cancel or Escape at either question deletes nothing.
 */
export function PurgeDialog({ preview, onConfirm, onClose }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const [again, setAgain] = useState(false);
  const count = (n: number) => formatCount(n, lang);
  const message = again
    ? purgeAgain(preview, t, size, count)
    : purgeMessage(preview, t, size, (seconds) => formatDate(seconds * 1000, lang), count);
  const action = again
    ? { label: t("purge.confirmAgain"), run: onConfirm, danger: true }
    : { label: t("purge.confirm"), run: () => setAgain(true), danger: true, keepOpen: true };
  return (
    <ConfirmDialog
      message={message}
      actions={[action]}
      focusCancel
      ignoreHeldKeys
      onClose={onClose}
    />
  );
}

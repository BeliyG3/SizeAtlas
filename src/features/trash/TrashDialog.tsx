import type { TrashPreview } from "../../api/types";
import { formatCount, formatDate } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { trashMessage } from "./text";

interface Props {
  preview: TrashPreview;
  onConfirm: () => void;
  onClose: () => void;
}

/** The confirmation of a trash request: what goes, its size, when it was scanned. Cancel has the focus. */
export function TrashDialog({ preview, onConfirm, onClose }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const message = trashMessage(
    preview,
    t,
    size,
    (seconds) => formatDate(seconds * 1000, lang),
    (n) => formatCount(n, lang),
  );
  return (
    <ConfirmDialog
      message={message}
      actions={[{ label: t("trash.confirm"), run: onConfirm }]}
      focusCancel
      onClose={onClose}
    />
  );
}

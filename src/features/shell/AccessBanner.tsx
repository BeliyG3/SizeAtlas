import { useT } from "../../i18n/react";
import { AccessInfo, type AccessProps } from "./AccessInfo";

interface Props extends AccessProps {
  onDismiss: () => void;
}

/** Unreadable folders and what can be done about them; × closes it (the chip in the status bar stays). */
export function AccessBanner({ onDismiss, ...info }: Props) {
  const { t } = useT();
  return (
    <p className="banner" role="note">
      <AccessInfo {...info} />
      <button
        className="close"
        aria-label={t("banner.dismiss")}
        title={t("banner.dismiss")}
        onClick={onDismiss}
      >
        ×
      </button>
    </p>
  );
}

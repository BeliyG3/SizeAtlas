import { api } from "../../api/client";
import { useT } from "../../i18n/react";
import type { Release } from "./github";

interface Props {
  release: Release;
  onDismiss: () => void;
  onError: (e: unknown) => void;
}

/** A newer release is out: Download opens its page in the browser; nothing is downloaded here. */
export function UpdateBanner({ release, onDismiss, onError }: Props) {
  const { t } = useT();
  return (
    <p className="banner" role="note">
      <span>{t("update.available", { version: release.version })}</span>
      <button onClick={() => void api.openUrl(release.url).catch(onError)}>
        {t("update.download")}
      </button>
      <button
        className="close"
        aria-label={t("update.dismiss")}
        title={t("update.dismiss")}
        onClick={onDismiss}
      >
        ×
      </button>
    </p>
  );
}

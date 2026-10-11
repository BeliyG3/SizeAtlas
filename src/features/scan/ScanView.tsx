import type { ScanProgress } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { scanFraction } from "../shell/source";
import "./scan.css";

interface Props {
  path: string;
  progress: ScanProgress | null;
  expected: number | null;
  /** Waits for another scan to finish. */
  queued: boolean;
}

/** A root without a tree yet: the progress of its scan, or a note that it waits; Cancel is on the toolbar and in the root's menu. */
export function ScanView({ path, progress, expected, queued }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  return (
    <section className="scan-view">
      <h2>{t(queued ? "scan.titleQueued" : "scan.title", { path })}</h2>
      {queued ? (
        <p className="dim">{t("scan.queued")}</p>
      ) : (
        <progress
          aria-label={t("scan.progress")}
          max={1}
          value={scanFraction(progress?.bytes ?? 0, expected)}
        />
      )}
      {progress && (
        <>
          <p>
            {t("scan.counters", {
              files: formatCount(progress.files, lang),
              dirs: formatCount(progress.dirs, lang),
              size: size(progress.bytes),
            })}
          </p>
          <p className="dim current">{progress.current}</p>
        </>
      )}
    </section>
  );
}

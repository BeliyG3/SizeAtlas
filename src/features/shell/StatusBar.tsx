import { useState, type ReactNode } from "react";
import type { ScanProgress, Summary } from "../../api/types";
import { formatAgo, formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { scanFraction } from "./source";

interface Props {
  /** The root of the selected node. */
  summary: Summary | null;
  /**
   * The running job: its root, the folder a refresh scans again (null for a full scan), its
   * progress and the bytes it should find, if known.
   */
  scan: {
    root: string;
    folder: string | null;
    progress: ScanProgress | null;
    expected: number | null;
  } | null;
  /** The running trash request, if any (`TrashStatus`). */
  trash: ReactNode;
}

/** "Scanned 5 minutes ago", fixed when shown: render stays pure; a new scan remounts it. */
function Ago({ at }: { at: number }) {
  const { t, lang } = useT();
  const [now] = useState(Date.now);
  return <span className="dim">{t("status.scanned", { ago: formatAgo(at, now, lang) })}</span>;
}

/** The running job, on the right: its root or folder, the files so far, the path and the progress. */
function ScanStatus({ root, folder, progress, expected }: NonNullable<Props["scan"]>) {
  const { t, lang } = useT();
  const current = progress?.current ?? "";
  const files = { count: progress?.files ?? 0, files: formatCount(progress?.files ?? 0, lang) };
  return (
    <span className="scan">
      <span className="counters">
        {folder === null
          ? t("status.scanning", { root, ...files })
          : t("status.refreshing", { folder, ...files })}
      </span>
      <span className="ellipsis path dim" dir="auto" title={current}>
        {current}
      </span>
      <progress
        aria-label={t("scan.progress")}
        max={1}
        value={scanFraction(progress?.bytes ?? 0, expected)}
      />
    </span>
  );
}

export function StatusBar({ summary, scan, trash }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  return (
    <footer className="statusbar">
      {summary && (
        <>
          <span>
            {t("status.files", { count: summary.files, files: formatCount(summary.files, lang) })},{" "}
            {t("status.dirs", { count: summary.dirs, dirs: formatCount(summary.dirs, lang) })} ·{" "}
            {size(summary.total)}
          </span>
          {summary.volume && (
            <span>
              {t("status.free", { size: size(summary.volume.free) })} ·{" "}
              <span title={t("tree.unaccountedHint")}>
                {t("status.unaccounted", { size: size(summary.volume.unaccounted) })}
              </span>
            </span>
          )}
          <Ago key={summary.generation} at={summary.scannedAt} />
        </>
      )}
      {scan && <ScanStatus {...scan} />}
      {trash}
    </footer>
  );
}

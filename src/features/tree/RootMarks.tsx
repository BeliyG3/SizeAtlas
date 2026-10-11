import { formatCount } from "../../format";
import { useT } from "../../i18n/react";

/** The scan of a root: a spinner with the files counted so far, or "queued". */
export function ScanMark({
  status,
  files,
}: {
  status: "scanning" | "queued";
  files: number | undefined;
}) {
  const { t, lang } = useT();
  if (status === "queued") return <span className="tag">{t("tree.queued")}</span>;
  return (
    <>
      <span className="spinner" aria-hidden="true" />
      <span className="tag">
        {files === undefined
          ? t("tree.activeScan")
          : t("tree.scanning", { count: files, files: formatCount(files, lang) })}
      </span>
    </>
  );
}

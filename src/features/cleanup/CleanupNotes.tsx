import { useState } from "react";
import { api } from "../../api/client";
import type { List, Summary } from "../../api/types";
import { formatAgo, formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { staleScan } from "../lists/rows";
import { useElevated } from "../shell/elevation";
import { platform } from "../shell/platform";
import { InfoBlock } from "./InfoBlock";
import "./cleanup.css";

interface Props {
  list: Pick<List, "found" | "cleanup">;
  summary: Pick<Summary, "root" | "scannedAt" | "scanning">;
  onFail: (e: unknown) => void;
}

/**
 * What a clean-up list says above its rows: the total of every match, a note when the scan is
 * old, and the facts that are not rows (see `InfoBlock`). Nothing when it has nothing to say.
 */
export function CleanupNotes({ list, summary, onFail }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const [now] = useState(Date.now);
  const windows = platform() === "windows";
  const elevated = useElevated(windows);
  const [busy, setBusy] = useState(false);
  const found = list.found && list.found.count > 0 ? list.found : null;
  const info = list.cleanup?.info ?? [];
  const stale = !summary.scanning && staleScan(summary.scannedAt, now);
  if (!found && !stale && info.length === 0) return null;

  const restart =
    windows && elevated === false
      ? {
          busy,
          run: () => {
            setBusy(true);
            api.restartElevated([summary.root]).catch((e: unknown) => {
              setBusy(false);
              onFail(e);
            });
          },
        }
      : null;
  return (
    <div className="found cleanup-notes">
      {found && (
        // Announced when the answer comes, not again at every refresh of a live scan.
        <p className="dim pad" role={summary.scanning ? undefined : "status"}>
          {t(list.cleanup?.approximate ? "cleanup.foundApprox" : "cleanup.found", {
            count: found.count,
            items: formatCount(found.count, lang),
            size: size(found.size),
          })}
        </p>
      )}
      {stale && (
        <p className="dim pad">
          {t("cleanup.stale", { ago: formatAgo(summary.scannedAt, now, lang) })}
        </p>
      )}
      <InfoBlock
        info={info}
        restart={restart}
        onCopy={(command) => void api.copyText(command).catch(onFail)}
      />
    </div>
  );
}

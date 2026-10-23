import { useContext } from "react";
import { api } from "../../api/client";
import type { List, Summary } from "../../api/types";
import { formatAgo, formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { useElevated, useRestartElevated } from "../shell/elevation";
import { platform } from "../shell/platform";
import { NoticeContext } from "../toasts/notices";
import { restartOffered, visibleInfo } from "./access";
import { InfoBlock } from "./InfoBlock";
import { staleScan } from "./stale";
import { useNow } from "./useNow";
import "./cleanup.css";

/** How often the age of the scan is looked at again. */
const NOW_PERIOD_MS = 5 * 60 * 1000;

interface Props {
  list: Pick<List, "found" | "cleanup">;
  summary: Pick<Summary, "root" | "scannedAt" | "scanning" | "accessErrors">;
  onFail: (e: unknown) => void;
}

/**
 * What a clean-up list says above its rows: the total of every match, a note when the scan is
 * old, and the facts that are not rows (see `InfoBlock`). Nothing when it has nothing to say.
 */
export function CleanupNotes({ list, summary, onFail }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const now = useNow(NOW_PERIOD_MS);
  const { push, errorText } = useContext(NoticeContext);
  const os = platform();
  const elevated = useElevated(os === "windows");
  const restart = useRestartElevated(summary.root, push, errorText);
  const found = list.found && list.found.count > 0 ? list.found : null;
  const info = visibleInfo(list.cleanup?.info ?? [], os, elevated);
  const stale = !summary.scanning && staleScan(summary.scannedAt, now);
  if (!found && !stale && info.length === 0) return null;

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
        restart={restartOffered(os, elevated, summary.accessErrors) ? restart : null}
        onCopy={(command) => void api.copyText(command).catch(onFail)}
      />
    </div>
  );
}

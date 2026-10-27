import type { DupEstimate, DupStatus, DupUnread } from "../../api/duplicates";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { totalFree, type DupState } from "./groups";

interface Props {
  estimate: DupEstimate | null;
  state: DupState | null;
  /** The latest status: of the running search, or of the kept result. */
  status: DupStatus | null;
  /** The words of the search field and the switch: what Find would search for. */
  query: string;
  system: boolean;
  /** "In all open drives": off searches the folder selected in the tree. */
  everywhere: boolean;
  /** A Find is being sent: Find is off until it is taken. */
  finding?: boolean;
  onSystem: (system: boolean) => void;
  onEverywhere: (everywhere: boolean) => void;
  /** Find, or Continue: a new search (counted files come from the cache). */
  onFind: () => void;
  onCancel: () => void;
}

const REASONS: readonly (keyof DupUnread)[] = ["cloud", "changed", "noAccess", "failed"];

/**
 * Above the groups: the total, the progress with Cancel or Find (Continue after a search that
 * did not finish), the folder searched, what is out of date, left out or unread, and the
 * switches of the system folders and of every open drive.
 */
export function DupHeader({
  estimate,
  state,
  status,
  query,
  system,
  everywhere,
  finding = false,
  onSystem,
  onEverywhere,
  onFind,
  onCancel,
}: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const count = (n: number) => formatCount(n, lang);
  const answer = state?.answer ?? null;
  const job = state?.job ?? 0;
  const running = status?.running ?? answer?.running ?? false;
  const stale = job > 0 && (status?.stale ?? answer?.stale ?? false);
  // Continue searches again for the same thing; after another query or folder it would be a new
  // search. The estimate follows what Find would search: its folder is the one Find takes.
  const unfinished = job > 0 && !running && answer !== null && !answer.complete;
  const resumable =
    unfinished &&
    answer.query === query &&
    answer.system === system &&
    answer.scope === (estimate?.scope ?? null);
  const unread = answer?.unread;
  const unreadCount = unread ? REASONS.reduce((sum, r) => sum + unread[r], 0) : 0;
  const groups = state?.groups.size ?? 0;
  // What the shown result left out; before any, what a search would leave out now.
  const skipped = (job > 0 ? answer?.skipped : estimate?.skipped) ?? [];
  const scope = job > 0 ? answer?.scope : estimate?.scope;

  let progress = null;
  if (running && status) {
    const full = status.phase === "full";
    const [done, total] = full
      ? [status.bytesDone, status.bytesTotal]
      : [status.filesDone, status.filesTotal];
    const shown = full ? size : count;
    progress = (
      <>
        <span>
          {t(full ? "dup.phaseFull" : "dup.phasePrefix", {
            done: shown(done),
            total: shown(total),
          })}
        </span>
        <progress value={done} max={Math.max(total, 1)} />
      </>
    );
  }

  return (
    <div className="dup-header">
      <p className="dup-line">
        {/* The totals only: the progress and the controls stay out of the live region. */}
        <span role="status">
          {job > 0 ? (
            <b>
              {t("dup.summary", {
                count: groups,
                groups: count(groups),
                size: size(totalFree(state?.groups.values() ?? [])),
              })}
            </b>
          ) : (
            estimate &&
            t("dup.toCompare", {
              count: estimate.files,
              files: count(estimate.files),
              size: size(estimate.bytes),
            })
          )}
        </span>
        {progress}
        {running ? (
          <button type="button" onClick={onCancel}>
            {t("dup.cancel")}
          </button>
        ) : (
          <button type="button" disabled={finding} onClick={onFind}>
            {t(resumable ? "dup.continue" : "dup.find")}
          </button>
        )}
        <label className="dup-system">
          <input
            type="checkbox"
            checked={system}
            disabled={running}
            onChange={(e) => onSystem(e.currentTarget.checked)}
          />
          {t("dup.system")}
        </label>
        <label className="dup-system">
          <input
            type="checkbox"
            checked={everywhere}
            disabled={running}
            onChange={(e) => onEverywhere(e.currentTarget.checked)}
          />
          {t("dup.everywhere")}
        </label>
      </p>
      {scope && <p className="dim">{t("dup.scope", { path: scope })}</p>}
      {unfinished && <p className="dim">{t("dup.unfinished")}</p>}
      {stale && <p className="dup-warn">{t("dup.stale")}</p>}
      {skipped.length > 0 && (
        <p className="dim">{t("dup.skipped", { roots: skipped.join(", ") })}</p>
      )}
      {unread && unreadCount > 0 && (
        <p className="dim">
          {t("dup.unread", {
            count: unreadCount,
            files: count(unreadCount),
            reasons: REASONS.filter((r) => unread[r] > 0)
              .map((r) => t(`dup.reason.${r}`, { count: count(unread[r]) }))
              .join(", "),
          })}
        </p>
      )}
      <p className="dim">{t("dup.note")}</p>
    </div>
  );
}

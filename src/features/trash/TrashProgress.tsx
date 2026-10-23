import type { TrashProgress } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { itemName, trashProgressText } from "./text";
import "./trash.css";

/** A request of more items than this also gets a progress window, with its Stop button. */
export const WINDOW_ITEMS = 20;

interface Props {
  progress: TrashProgress;
  /** Stop was pressed: the request ends after the item that moves now. */
  stopping: boolean;
  /** The items are deleted for good: the texts say so, not "to the trash". */
  purge: boolean;
  onStop: () => void;
}

/** "Moving to the trash: 3 of 120" (or "Deleting permanently"), that item's path, the bar, Stop. */
function useLine(progress: TrashProgress, stopping: boolean, purge: boolean) {
  const { t, lang } = useT();
  const { done, total, current } = progress;
  const title = t(purge ? "purge.title" : "trash.title");
  return {
    title,
    text: trashProgressText(progress, t, (n) => formatCount(n, lang), purge),
    path: current ?? "",
    bar: <progress aria-label={title} max={Math.max(1, total)} value={Math.min(done, total)} />,
    stop: t(stopping ? "trash.stopping" : "trash.stop"),
  };
}

/** The running trash request in the status bar; `onStop` null when the window offers Stop. */
export function TrashStatus({
  progress,
  stopping,
  purge,
  onStop,
}: Omit<Props, "onStop"> & { onStop: (() => void) | null }) {
  const line = useLine(progress, stopping, purge);
  return (
    <span className="scan">
      <span className="counters">{line.text}</span>
      {line.path && (
        <span className="ellipsis path dim" title={line.path}>
          — {itemName(line.path)}
        </span>
      )}
      {line.bar}
      {onStop && (
        <button type="button" className="link" disabled={stopping} onClick={onStop}>
          {line.stop}
        </button>
      )}
    </span>
  );
}

/** The running trash request of many items, in the middle of the window; the app stays usable. */
export function TrashWindow({ progress, stopping, purge, onStop }: Props) {
  const line = useLine(progress, stopping, purge);
  return (
    <section className="trash-window" role="dialog" aria-label={line.title}>
      <h2>{line.title}</h2>
      <p>{line.text}</p>
      <p className="ellipsis dim" title={line.path}>
        {line.path ? itemName(line.path) : " "}
      </p>
      {line.bar}
      <div className="actions">
        <button type="button" disabled={stopping} onClick={onStop}>
          {line.stop}
        </button>
      </div>
    </section>
  );
}

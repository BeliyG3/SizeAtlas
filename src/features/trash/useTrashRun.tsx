import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, onTrashProgress } from "../../api/client";
import { applyProgress, shownRuns, type Run, type TrashRun } from "./runs";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { cancelledText } from "./text";
import { TrashStatus, TrashWindow, TrashWindows, WINDOW_ITEMS } from "./TrashProgress";

/**
 * The removal requests as the user sees them (`Run`): the progress of each (from
 * `trash-progress`), its Stop, and the rows they move. The status bar shows the first two that
 * started and how many more there are; a request of many items also gets a window of its own.
 */
export function useTrashRun(onError: (e: unknown) => void, push: (text: string) => void) {
  const { t, lang } = useT();
  const [runs, setRuns] = useState<readonly Run[]>([]);
  // The number of the next request: the first from the clock, so a reloaded view never reuses
  // one that may still run in the backend.
  const nextRequest = useRef<number | null>(null);
  useEffect(() => {
    let live = true;
    // An event of a request that is no run (ended, or not ours) changes nothing.
    const unlisten = onTrashProgress((p) => {
      if (live) setRuns((rs) => applyProgress(rs, p));
    });
    return () => {
      live = false;
      void unlisten.then((f) => f());
    };
  }, []);

  /** Adds `next` as a request that waits; returns its number for the backend. */
  const start = (next: TrashRun): number => {
    const request = nextRequest.current ?? Date.now();
    nextRequest.current = request + 1;
    setRuns((rs) => [...rs, { ...next, request, progress: null, stopping: false }]);
    return request;
  };
  const end = (request: number) => setRuns((rs) => rs.filter((r) => r.request !== request));
  const stop = (request: number) => {
    setRuns((rs) => rs.map((r) => (r.request === request ? { ...r, stopping: true } : r)));
    // Stop also cancels the waiting requests of that volume: say how many.
    api.cancelTrash(request).then((n) => {
      if (n > 0) push(cancelledText(n, t, (c) => formatCount(c, lang)));
    }, onError);
  };

  // A request that waits has no progress yet: it shows nowhere but on its rows.
  const { shown, more } = shownRuns(runs);
  const big = (r: Run) => r.preview.count > WINDOW_ITEMS;
  const line = (r: Run) => ({
    progress: r.progress ?? { request: r.request, done: 0, total: r.preview.count, current: null },
    stopping: r.stopping,
    purge: r.purge,
  });
  const status: ReactNode =
    shown.length === 0 ? null : (
      <>
        {shown.map((r) => (
          <TrashStatus
            key={r.request}
            {...line(r)}
            root={r.root}
            onStop={big(r) ? null : () => stop(r.request)}
          />
        ))}
        {more > 0 && (
          // Isolated, so a right-to-left interface still reads "+N".
          <bdi dir="ltr" className="dim">
            {`+${formatCount(more, lang)}`}
          </bdi>
        )}
      </>
    );
  const windows = runs.filter((r) => r.progress !== null && big(r));
  const floating: ReactNode =
    windows.length === 0 ? null : (
      <TrashWindows>
        {windows.map((r) => (
          <TrashWindow key={r.request} {...line(r)} onStop={() => stop(r.request)} />
        ))}
      </TrashWindows>
    );
  const roots = useMemo(() => new Set(runs.map((r) => r.root)), [runs]);
  return { roots, start, end, moving: runs, status, windows: floating };
}

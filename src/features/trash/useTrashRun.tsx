import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, onTrashProgress } from "../../api/client";
import { applyProgress, type Run, type TrashRun } from "./runs";
import { TrashStatus, TrashWindow, WINDOW_ITEMS } from "./TrashProgress";

/**
 * The removal requests as the user sees them (`Run`): the progress of each (from
 * `trash-progress`), Stop, and the rows they move. For now the status bar and the window show the
 * first one.
 */
export function useTrashRun(onError: (e: unknown) => void) {
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
    api.cancelTrash(request).catch(onError);
  };

  let status: ReactNode = null;
  let floating: ReactNode = null;
  const run = runs[0];
  if (run) {
    const shown = run.progress ?? {
      request: run.request,
      done: 0,
      total: run.preview.count,
      current: null,
    };
    const big = run.preview.count > WINDOW_ITEMS;
    const line = { progress: shown, stopping: run.stopping, purge: run.purge };
    const onStop = () => stop(run.request);
    status = <TrashStatus {...line} onStop={big ? null : onStop} />;
    if (big) floating = <TrashWindow {...line} onStop={onStop} />;
  }
  return { root: run?.root ?? null, start, end, moving: runs, status, window: floating };
}

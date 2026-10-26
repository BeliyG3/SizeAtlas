import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, onTrashProgress } from "../../api/client";
import type { TrashPreview, TrashProgress } from "../../api/types";
import type { Moving } from "./moving";
import { TrashStatus, TrashWindow, WINDOW_ITEMS } from "./TrashProgress";

/** The request that runs: its tree and root, the items asked for and their preview. */
export interface TrashRun {
  generation: number;
  root: string;
  ids: readonly number[];
  preview: TrashPreview;
  /** The items are deleted for good, not moved to the trash. */
  purge: boolean;
}

/**
 * The running trash (or delete) request as the user sees it: its progress (from
 * `trash-progress`) in the status bar and, for many items, in a window of its own, Stop, and the
 * rows it moves.
 */
export function useTrashRun(onError: (e: unknown) => void) {
  const [run, setRun] = useState<(TrashRun & { request: number; stopping: boolean }) | null>(null);
  // The progress of any request; only that of `run` is shown.
  const [progress, setProgress] = useState<TrashProgress | null>(null);
  // The number of the next request: the first from the clock, so a reloaded view never reuses
  // one that may still run in the backend.
  const nextRequest = useRef<number | null>(null);
  // Set with the request, not derived from it: Stop does not change the rows.
  const [moving, setMoving] = useState<Moving | null>(null);
  useEffect(() => {
    let live = true;
    const unlisten = onTrashProgress((p) => {
      if (live) setProgress(p);
    });
    return () => {
      live = false;
      void unlisten.then((f) => f());
    };
  }, []);

  /** Shows `next` as the running request; returns its number for the backend. */
  const start = (next: TrashRun): number => {
    const request = nextRequest.current ?? Date.now();
    nextRequest.current = request + 1;
    setProgress(null);
    setRun({ ...next, request, stopping: false });
    setMoving({ generation: next.generation, ids: new Set(next.ids), purge: next.purge });
    return request;
  };
  const end = () => {
    setRun(null);
    setMoving(null);
  };
  const stop = () => {
    if (!run) return;
    setRun((r) => r && { ...r, stopping: true });
    api.cancelTrash(run.request).catch(onError);
  };

  let status: ReactNode = null;
  let floating: ReactNode = null;
  if (run) {
    const own = progress?.request === run.request ? progress : null;
    const shown = own ?? { request: run.request, done: 0, total: run.preview.count, current: null };
    const big = run.preview.count > WINDOW_ITEMS;
    const line = { progress: shown, stopping: run.stopping, purge: run.purge };
    status = <TrashStatus {...line} onStop={big ? null : stop} />;
    if (big) floating = <TrashWindow {...line} onStop={stop} />;
  }
  return { root: run?.root ?? null, start, end, moving, status, window: floating };
}

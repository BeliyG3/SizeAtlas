import { useEffect, useState, type ReactNode } from "react";
import { api, onTrashProgress } from "../../api/client";
import type { TrashPreview, TrashProgress } from "../../api/types";
import type { Moving } from "./moving";
import { TrashStatus, TrashWindow, WINDOW_ITEMS } from "./TrashProgress";

/** The trash request that runs: its tree and root, the items asked for and their preview. */
export interface TrashRun {
  generation: number;
  root: string;
  ids: readonly number[];
  preview: TrashPreview;
}

/**
 * The running trash request as the user sees it: its progress (from `trash-progress`) in the
 * status bar and, for many items, in a window of its own, Stop, and the rows it moves.
 */
export function useTrashRun(onError: (e: unknown) => void) {
  const [run, setRun] = useState<(TrashRun & { stopping: boolean }) | null>(null);
  const [progress, setProgress] = useState<TrashProgress | null>(null);
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

  const start = (next: TrashRun) => {
    setProgress(null);
    setRun({ ...next, stopping: false });
    setMoving({ generation: next.generation, ids: new Set(next.ids) });
  };
  const end = () => {
    setRun(null);
    setMoving(null);
  };
  const stop = () => {
    setRun((r) => r && { ...r, stopping: true });
    api.cancelTrash().catch(onError);
  };

  let status: ReactNode = null;
  let floating: ReactNode = null;
  if (run) {
    const shown = progress ?? { done: 0, total: run.preview.count, current: null };
    const big = run.preview.count > WINDOW_ITEMS;
    status = <TrashStatus progress={shown} stopping={run.stopping} onStop={big ? null : stop} />;
    if (big) floating = <TrashWindow progress={shown} stopping={run.stopping} onStop={stop} />;
  }
  return { root: run?.root ?? null, start, end, moving, status, window: floating };
}

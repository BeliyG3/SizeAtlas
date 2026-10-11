import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  onClosing,
  onLiveTreeChanged,
  onRootsChanged,
  onScanError,
  onScanProgress,
} from "../api/client";
import type { ScanError, ScanProgress, Sources } from "../api/types";
import { readStored, writeStored } from "../settings/storage";
import { LAST_ROOT_KEY, ROOTS_KEY, rootsToReopen, storedRoots } from "./roots";
import { useRootRefresh } from "./useRootRefresh";

/** Opens saved scans one by one, in their order; resolves to how many could not be opened. */
async function reopen(roots: readonly string[]): Promise<number> {
  let skipped = 0;
  for (const root of roots) {
    try {
      await api.openCached(root);
    } catch {
      skipped++;
    }
  }
  return skipped;
}

/**
 * The open roots and the scan queue as the backend reports them, the drives and saved scans,
 * and the actions that change them. At start, reopens the roots that were open last time.
 */
export function useRoots(
  onError: (e: unknown) => void,
  onSkipped: (count: number) => void,
  onScanFailed: (e: ScanError) => void,
) {
  const [sources, setSources] = useState<Sources | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [closing, setClosing] = useState(false);
  // The handlers change with the language; the subscriptions below must not.
  const handlers = useRef({ onError, onSkipped, onScanFailed });
  useEffect(() => {
    handlers.current = { onError, onSkipped, onScanFailed };
  }, [onError, onSkipped, onScanFailed]);
  const fail = useCallback((e: unknown) => handlers.current.onError(e), []);
  const { roots, refresh: refreshRoots } = useRootRefresh(fail);

  // Lists can overtake each other: only the latest one lands.
  const askedSources = useRef(0);
  const lifecycle = useRef({ live: false });
  const refreshSources = useCallback(() => {
    const request = ++askedSources.current;
    const life = lifecycle.current;
    return api.listSources().then(
      (next) => {
        if (life.live && request === askedSources.current) setSources(next);
      },
      (e: unknown) => {
        if (life.live) fail(e);
      },
    );
  }, [fail]);

  // Only the latest list lands here too. While the roots of the last run reopen, the remembered
  // list stays as it was, so quitting early loses none of them.
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    if (!restoring) writeStored(ROOTS_KEY, storedRoots(roots));
  }, [roots, restoring]);

  // StrictMode reuses the same reopen promise, but only the active effect receives its answer.
  const opening = useRef<Promise<number> | null>(null);
  useEffect(() => {
    const life = { live: true };
    lifecycle.current = life;
    void refreshSources();
    void refreshRoots();
    if (!opening.current) {
      const remembered = rootsToReopen(readStored(ROOTS_KEY), readStored(LAST_ROOT_KEY));
      opening.current = reopen(remembered);
    }
    void opening.current.then((skipped) => {
      if (!life.live) return;
      setRestoring(false);
      void refreshRoots();
      if (skipped > 0) handlers.current.onSkipped(skipped);
      // Roots named by a restart as administrator: scanned again, like the toolbar Rescan.
      void api.takeStartupRescans().then(
        (paths) => {
          if (!life.live) return;
          for (const path of paths) void api.scan(path).catch(fail);
        },
        (e: unknown) => {
          if (life.live) fail(e);
        },
      );
    });
    const unlisten = [
      onRootsChanged(() => {
        if (!life.live) return;
        void refreshRoots();
        void refreshSources();
      }),
      onScanProgress((progress) => {
        if (life.live) setProgress(progress);
      }),
      onLiveTreeChanged(() => {
        if (life.live) void refreshRoots();
      }),
      onScanError((e) => {
        if (life.live) handlers.current.onScanFailed(e);
      }),
      onClosing(() => {
        if (life.live) setClosing(true);
      }),
    ];
    return () => {
      life.live = false;
      unlisten.forEach((u) => void u.then((f) => f()));
    };
  }, [refreshRoots, refreshSources, fail]);

  /** Queues a scan; resolves to its canonical root, or to null if it was refused. */
  const scan = useCallback(
    (path: string) =>
      api.scan(path).catch((e: unknown) => {
        fail(e);
        return null;
      }),
    [fail],
  );
  /** Without a root: the running scan. */
  const cancel = useCallback((root?: string) => void api.cancelScan(root).catch(fail), [fail]);
  /** Opens a saved scan as a root; resolves to its summary, or to null if it could not be read. */
  const openCached = useCallback(
    (root: string) =>
      api.openCached(root).catch((e: unknown) => {
        fail(e);
        void refreshSources();
        return null;
      }),
    [fail, refreshSources],
  );
  /** Removes `root` from the tree, with or without a tree yet, and stops its scan. */
  const closeRoot = useCallback((root: string) => void api.closeRoot(root).catch(fail), [fail]);
  /** Deletes the saved scan of `root` and closes the root. */
  const forget = useCallback((root: string) => void api.forgetScan(root).catch(fail), [fail]);

  const running = roots.queue.find((q) => q.state === "scanning") ?? null;
  const scanning = running?.root ?? null;
  return {
    sources,
    roots,
    closing,
    /** True while the roots of the last run are being reopened. */
    restoring,
    /** The running job: a scan of a root or a refresh of one of its folders; null if none. */
    running,
    /** Root of the running job, or null. */
    scanning,
    /** Progress of the running scan, once it has reported any. */
    progress: progress?.root === scanning ? progress : null,
    scan,
    cancel,
    openCached,
    closeRoot,
    forget,
    refreshRoots,
  };
}

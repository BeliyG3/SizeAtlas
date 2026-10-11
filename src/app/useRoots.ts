import { useCallback, useEffect, useRef, useState } from "react";
import { api, onClosing, onRootsChanged, onScanError, onScanProgress } from "../api/client";
import type { Roots, ScanError, ScanProgress, Sources } from "../api/types";
import { readStored, writeStored } from "../settings/storage";
import { LAST_ROOT_KEY, ROOTS_KEY, rootsToReopen, storedRoots } from "./roots";

const NO_ROOTS: Roots = { roots: [], queue: [] };

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
  const [roots, setRoots] = useState<Roots>(NO_ROOTS);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [closing, setClosing] = useState(false);
  // The handlers change with the language; the subscriptions below must not.
  const handlers = useRef({ onError, onSkipped, onScanFailed });
  useEffect(() => {
    handlers.current = { onError, onSkipped, onScanFailed };
  }, [onError, onSkipped, onScanFailed]);
  const fail = useCallback((e: unknown) => handlers.current.onError(e), []);

  // Lists can overtake each other: only the latest one lands.
  const askedSources = useRef(0);
  const refreshSources = useCallback(() => {
    const request = ++askedSources.current;
    return api.listSources().then((next) => {
      if (request === askedSources.current) setSources(next);
    }, fail);
  }, [fail]);

  // Only the latest list lands here too. While the roots of the last run reopen, the remembered
  // list stays as it was, so quitting early loses none of them.
  const asked = useRef(0);
  const reopening = useRef(true);
  const [restoring, setRestoring] = useState(true);
  const refreshRoots = useCallback(() => {
    const request = ++asked.current;
    return api.listRoots().then((next) => {
      if (request !== asked.current) return;
      setRoots(next);
      if (!reopening.current) writeStored(ROOTS_KEY, storedRoots(next));
    }, fail);
  }, [fail]);

  // StrictMode runs effects twice in dev; the ref keeps the reopening to once per app instance.
  const started = useRef(false);
  useEffect(() => {
    void refreshSources();
    void refreshRoots();
    if (!started.current) {
      started.current = true;
      const remembered = rootsToReopen(readStored(ROOTS_KEY), readStored(LAST_ROOT_KEY));
      void reopen(remembered).then((skipped) => {
        reopening.current = false;
        setRestoring(false);
        void refreshRoots();
        if (skipped > 0) handlers.current.onSkipped(skipped);
        // Roots named by a restart as administrator: scanned again, like the toolbar Rescan.
        void api.takeStartupRescans().then((paths) => {
          for (const path of paths) void api.scan(path).catch(fail);
        }, fail);
      });
    }
    const unlisten = [
      onRootsChanged(() => {
        void refreshRoots();
        void refreshSources();
      }),
      onScanProgress(setProgress),
      onScanError((e) => handlers.current.onScanFailed(e)),
      onClosing(() => setClosing(true)),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()));
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

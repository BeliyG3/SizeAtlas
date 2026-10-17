import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isCmdError } from "../api/client";
import { ROOT_ID, type ScanError } from "../api/types";
import { ExportContext } from "../features/export/source";
import { useExport } from "../features/export/useExport";
import { AppMenuBar } from "../features/menubar/AppMenuBar";
import { AccessBanner } from "../features/shell/AccessBanner";
import { chooseFolder } from "../features/shell/chooseFolder";
import { StatusBar } from "../features/shell/StatusBar";
import { Toolbar } from "../features/shell/Toolbar";
import { expectedBytes, forgettable, savedScan } from "../features/shell/source";
import { Toasts, useToasts } from "../features/toasts/Toasts";
import { MODE_KEY, parseMode } from "../features/lists/modes";
import { useStored } from "../settings/storage";
import { formatCount } from "../format";
import { useT } from "../i18n/react";
import { Browser } from "./Browser";
import { busyRoots, fullScanRoots, rootEntries, runningFullScanRoots } from "./roots";
import { useChangeKeys } from "./useChangeKeys";
import { useTrash } from "./useTrash";
import { useRoots } from "./useRoots";
import { useSelection } from "./useSelection";

export function App() {
  const { t, lang } = useT();
  const { toasts, push, pushError, errorText } = useToasts();
  const onSkipped = useCallback(
    (count: number) => push(t("restore.skipped", { count, roots: formatCount(count, lang) })),
    [push, t, lang],
  );
  const onScanError = useCallback(
    (e: ScanError) => push(t("scan.error", { root: e.root, message: errorText(e.error) })),
    [push, t, errorText],
  );
  const [mode, setMode] = useStored(MODE_KEY, parseMode);
  const roots = useRoots(pushError, onSkipped, onScanError);
  const { sources, scanning, running, progress, refreshRoots } = roots;

  // One stable failure handler for every request of the view. StaleId means that a root was
  // replaced or closed under the view: the list of roots tells what it shows now.
  const handlers = useRef({ pushError, refreshRoots });
  useEffect(() => {
    handlers.current = { pushError, refreshRoots };
  }, [pushError, refreshRoots]);
  const fail = useCallback((e: unknown) => {
    if (isCmdError(e) && e.code === "StaleId") void handlers.current.refreshRoots();
    else handlers.current.pushError(e);
  }, []);

  const entries = useMemo(() => rootEntries(roots.roots), [roots.roots]);
  const { selection, selectRoot, selectNode, history } = useSelection(
    entries,
    fail,
    roots.restoring,
  );
  const summary = entries.find((e) => e.root === selection?.root)?.summary ?? null;
  const inTree = useMemo(() => new Set(entries.map((e) => e.root)), [entries]);
  const waiting = useMemo(() => fullScanRoots(roots.roots), [roots.roots]);
  const fullScans = useMemo(() => runningFullScanRoots(roots.roots), [roots.roots]);
  const busy = useMemo(() => busyRoots(roots.roots), [roots.roots]);
  const selectedRoot = selection?.root ?? null;
  // The source picked on the toolbar holds while the same root stays selected.
  const [picked, setPicked] = useState<{ path: string; base: string | null } | null>(null);
  const pending = picked && picked.base === selectedRoot ? picked.path : selectedRoot;
  /** `path`, unless there is none or its scan runs or waits already. */
  const idle = (path: string | null) => (path !== null && !waiting.has(path) ? path : null);

  /** Selects a root once the list has it, so the view does not show another root meanwhile. */
  const selectAdded = async (root: string | null) => {
    if (root === null) return;
    await refreshRoots();
    selectRoot(root);
  };
  /** A drive or a source: select it if it is in the tree, open its saved scan if this version wrote it, else scan it. */
  const openSource = (path: string) => {
    if (entries.some((e) => e.root === path)) {
      selectRoot(path);
      return;
    }
    const saved = savedScan(sources, path);
    const opened =
      saved && !saved.outdated
        ? roots.openCached(path).then((s) => s?.root ?? null)
        : roots.scan(path);
    void opened.then(selectAdded);
  };
  /** Queues a scan; a new root gets selected, a rescan leaves the selection where it is. */
  const scanPath = (path: string) =>
    void roots.scan(path).then((root) => {
      if (root !== selection?.root) void selectAdded(root);
    });
  const scanFolder = () => void chooseFolder(scanPath, pushError);
  /** "Scan this folder": a folder of a tree becomes a root of its own. */
  const scanItem = (generation: number, id: number) =>
    void api.itemPath(generation, id).then(scanPath).catch(fail);

  /** F5 and "Refresh folder": the folder is scanned again in the queue; the root, fully. */
  const refreshFolder = useCallback(
    (generation: number, id: number) => void api.refreshFolder(generation, id).catch(fail),
    [fail],
  );
  const shownGeneration = selection?.generation ?? null;
  const shownFolder = selection?.folder ?? null;
  const rescanTarget = idle(selectedRoot);
  const rescan = rescanTarget === null ? null : () => scanPath(rescanTarget);
  // F5 on the root (or a file in it) scans the root again: the menu then says Rescan.
  const atRoot = shownFolder === ROOT_ID;
  const refreshCurrent =
    shownGeneration === null ||
    shownFolder === null ||
    (selectedRoot !== null && fullScans.has(selectedRoot))
      ? null
      : () => refreshFolder(shownGeneration, shownFolder);
  const trash = useTrash({
    roots: roots.roots,
    entries,
    selection,
    push,
    onError: fail,
    errorText,
  });
  const exporter = useExport(push, fail);
  useChangeKeys({
    onRefresh: () => refreshCurrent?.(),
    onRescan: () => rescan?.(),
    // Refused while a scan still lists the items: say why, as the menu item does.
    onDelete: () => {
      if (trash.menuTrash) trash.menuTrash();
      else if (trash.trashNote) push(trash.trashNote);
    },
    onExport: () => void exporter.run(exporter.separator),
  });

  return (
    <div className="app">
      <AppMenuBar
        scanTarget={idle(pending)}
        rescanTarget={rescanTarget}
        onRefresh={refreshCurrent}
        refreshIsRescan={atRoot}
        onTrash={trash.menuTrash}
        trashNote={trash.trashNote}
        scanning={scanning !== null}
        forgetTarget={forgettable(sources, pending)}
        onChooseFolder={scanFolder}
        onExport={summary ? (separator) => void exporter.run(separator) : null}
        exportSeparator={exporter.separator}
        onScan={scanPath}
        onCancel={() => roots.cancel()}
        onForget={roots.forget}
        onError={pushError}
      />
      <Toolbar
        canBack={history.canBack}
        canForward={history.canForward}
        onBack={history.back}
        onForward={history.forward}
        sources={sources}
        pending={pending}
        selectedRoot={selectedRoot}
        inTree={inTree}
        waiting={waiting}
        scanning={scanning !== null}
        onPick={(path) => setPicked({ path, base: selectedRoot })}
        onOpen={openSource}
        onScan={scanPath}
        onChooseFolder={scanFolder}
        onCancel={() => roots.cancel()}
        onForget={roots.forget}
        mode={mode}
        onMode={setMode}
      />
      {summary && summary.accessErrors > 0 && (
        <AccessBanner
          count={summary.accessErrors}
          root={summary.root}
          push={push}
          errorText={errorText}
        />
      )}
      <main className="workspace">
        <ExportContext value={exporter.register}>
          <Browser
            entries={entries}
            selection={selection}
            mode={mode}
            sources={sources}
            progress={progress}
            onSelectNode={selectNode}
            onSelectRoot={selectRoot}
            onRescan={(root) => void roots.scan(root)}
            onRefresh={refreshFolder}
            onScanFolder={scanItem}
            onTrash={trash.onTrash}
            onMarks={trash.onMarks}
            busyRoots={busy}
            job={trash.job}
            fullScans={fullScans}
            trashing={trash.busy}
            onCloseRoot={roots.closeRoot}
            onForget={roots.forget}
            onCancelScan={(root) => roots.cancel(root)}
            onOpenDrive={openSource}
            onScanDrive={scanPath}
            onFail={fail}
          />
        </ExportContext>
      </main>
      <StatusBar
        summary={summary}
        scan={
          running === null
            ? null
            : {
                root: running.root,
                folder: running.folder,
                progress,
                expected: running.folder === null ? expectedBytes(sources, running.root) : null,
              }
        }
        trashing={trash.busy}
      />
      {trash.dialog}
      <Toasts toasts={toasts} />
      {roots.closing && <div className="overlay">{t("closing")}</div>}
    </div>
  );
}

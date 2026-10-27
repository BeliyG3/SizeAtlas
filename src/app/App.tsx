import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isCmdError } from "../api/client";
import { ROOT_ID, type ScanError } from "../api/types";
import { ExportContext } from "../features/export/source";
import { useExport } from "../features/export/useExport";
import { AppMenuBar } from "../features/menubar/AppMenuBar";
import { chooseFolder } from "../features/shell/chooseFolder";
import { StatusBar } from "../features/shell/StatusBar";
import { useAccess } from "../features/shell/useAccess";
import { Toolbar } from "../features/shell/Toolbar";
import { expectedBytes, forgettable, savedScan } from "../features/shell/source";
import { NoticeContext } from "../features/toasts/notices";
import { Toasts, useToasts } from "../features/toasts/Toasts";
import { MovingContext } from "../features/trash/moving";
import { UpdateBanner } from "../features/update/UpdateBanner";
import { useUpdateCheck } from "../features/update/useUpdateCheck";
import { useCommittedQuery } from "../features/search/useCommittedQuery";
import { useSearchKey } from "../features/search/useSearchKey";
import { MODE_KEY, parseMode, type Mode } from "../features/lists/modes";
import { DUP_QUERY_KEY, parseDupQuery } from "../features/duplicates/query";
import { readStored, useStored, writeStored } from "../settings/storage";
import { formatCount } from "../format";
import { useT } from "../i18n/react";
import { Browser } from "./Browser";
import { busyRoots, fullScanRoots, rootEntries, runningFullScanRoots } from "./roots";
import { useChangeKeys } from "./useChangeKeys";
import { useDupWiring } from "./useDupWiring";
import { useTrash } from "./useTrash";
import { useRoots } from "./useRoots";
import { useSelection } from "./useSelection";

export function App() {
  const { t, lang } = useT();
  const { toasts, push, pushError, errorText } = useToasts();
  const notices = useMemo(() => ({ push, errorText }), [push, errorText]);
  const onSkipped = useCallback(
    (count: number) => push(t("restore.skipped", { count, roots: formatCount(count, lang) })),
    [push, t, lang],
  );
  const onScanError = useCallback(
    (e: ScanError) => push(t("scan.error", { root: e.root, message: errorText(e.error) })),
    [push, t, errorText],
  );
  const [mode, setMode] = useStored(MODE_KEY, parseMode);
  // The search is not stored, but the duplicates mode keeps its own: there the field filters
  // what is looked for. `query` is the text in the field; the table gets `committed`.
  const dupQuery = () => parseDupQuery(readStored(DUP_QUERY_KEY));
  const [query, setQuery] = useState(() => (mode === "duplicates" ? dupQuery() : ""));
  const { committed, commit } = useCommittedQuery(query);
  const searchField = useRef<HTMLInputElement>(null);
  useSearchKey(searchField);
  const endSearch = useCallback(() => setQuery(""), []);
  // Picking a mode ends the search, so that the table shows the mode.
  const showMode = (next: Mode) => {
    setMode(next);
    const text = next === "duplicates" ? dupQuery() : "";
    setQuery(text);
    // The stored search of the duplicates is estimated at once, not after the typing delay.
    if (text.trim() !== "") commit(text);
  };
  const editQuery = (next: string) => {
    setQuery(next);
    if (mode === "duplicates") writeStored(DUP_QUERY_KEY, next);
  };
  const update = useUpdateCheck(push);
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
  const access = useAccess(summary, {
    push,
    errorText,
    onShow: () => {
      showMode("unreadable");
      if (summary) selectRoot(summary.root);
    },
  });
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
  const trash = useTrash({
    roots: roots.roots,
    entries,
    selection,
    push,
    onTrashed: roots.refreshRootsNow,
    onError: fail,
    errorText,
  });
  // Not in the root whose items move to the trash: the tooltip says why.
  const trashingHere = selectedRoot !== null && trash.roots.has(selectedRoot);
  const refreshCurrent =
    shownGeneration === null ||
    shownFolder === null ||
    trashingHere ||
    (selectedRoot !== null && fullScans.has(selectedRoot))
      ? null
      : () => refreshFolder(shownGeneration, shownFolder);
  const { duplicates, menuTrash, trashNote } = useDupWiring(mode, trash, {
    ...notices,
    field: query,
    onCommit: commit,
    onTrashed: roots.refreshRootsNow,
  });
  const exporter = useExport(push, fail);
  useChangeKeys({
    onRefresh: () => refreshCurrent?.(),
    onRescan: () => rescan?.(),
    // Refused while a scan still lists the items: say why, as the menu item does.
    onDelete: () => {
      if (menuTrash) menuTrash();
      else if (trashNote) push(trashNote);
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
        refreshNote={trashingHere ? t("trash.busy") : null}
        onTrash={menuTrash}
        trashNote={trashNote}
        scanning={scanning !== null}
        forgetTarget={forgettable(sources, pending)}
        onChooseFolder={scanFolder}
        onExport={summary ? (separator) => void exporter.run(separator) : null}
        exportSeparator={exporter.separator}
        onScan={scanPath}
        onCancel={() => roots.cancel()}
        onForget={roots.forget}
        onError={pushError}
        update={update}
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
        onMode={showMode}
        query={query}
        onQuery={editQuery}
        onSearch={commit}
        searchRef={searchField}
      />
      {update.offered && (
        <UpdateBanner release={update.offered} onDismiss={update.dismiss} onError={pushError} />
      )}
      {access.banner}
      <main className="workspace">
        <ExportContext value={exporter.register}>
          <NoticeContext value={notices}>
            <MovingContext value={trash.moving}>
              <Browser
                entries={entries}
                selection={selection}
                mode={mode}
                query={committed}
                duplicates={duplicates}
                onLeaveSearch={endSearch}
                sources={sources}
                progress={progress}
                onSelectNode={selectNode}
                onSelectRoot={selectRoot}
                onRescan={(root) => void roots.scan(root)}
                onRefresh={refreshFolder}
                onScanFolder={scanItem}
                onTrash={trash.onTrash}
                onPurge={trash.onPurge}
                onMarks={trash.onMarks}
                busyRoots={busy}
                job={trash.job}
                fullScans={fullScans}
                isRemoving={trash.isRemoving}
                trashingRoots={trash.roots}
                onCloseRoot={roots.closeRoot}
                onForget={roots.forget}
                onCancelScan={(root) => roots.cancel(root)}
                onOpenDrive={openSource}
                onScanDrive={scanPath}
                onFail={fail}
              />
            </MovingContext>
          </NoticeContext>
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
        access={access.chip}
        trash={trash.status}
      />
      {trash.windows}
      {trash.dialog}
      <Toasts toasts={toasts} />
      {roots.closing && <div className="overlay">{t("closing")}</div>}
    </div>
  );
}

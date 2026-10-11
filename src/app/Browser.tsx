import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ScanProgress, Sources } from "../api/types";
import { DEFAULT_SORT, type SortState } from "../features/contents/columns";
import { DrivesPanel } from "../features/drives/DrivesPanel";
import { ItemMenu, type MenuTarget } from "../features/menu/ItemMenu";
import { RootMenu, type RootMenuTarget } from "../features/menu/RootMenu";
import { ScanView } from "../features/scan/ScanView";
import { Workspace } from "../features/shell/Workspace";
import { expectedBytes, isDrive, rootLabel } from "../features/shell/source";
import type { Mode } from "../features/lists/modes";
import { FolderTree } from "../features/tree/FolderTree";
import type { RootInfo } from "../features/tree/model";
import type { TreeTarget } from "../features/tree/TreeBody";
import { Viewer } from "../features/viewer/Viewer";
import { useT } from "../i18n/react";
import type { RootEntry } from "./roots";
import type { Selection } from "./selection";

interface Props {
  entries: readonly RootEntry[];
  selection: Selection | null;
  /** What the table shows. */
  mode: Mode;
  sources: Sources | null;
  /** Progress of the running scan. */
  progress: ScanProgress | null;
  onSelectNode: (generation: number, id: number, isDir: boolean, parent?: number) => void;
  onSelectRoot: (root: string) => void;
  onRescan: (root: string) => void;
  /** Queues a refresh of folder `id` of the tree with `generation`. */
  onRefresh: (generation: number, id: number) => void;
  /** Queues a scan of folder `id` of the tree with `generation` as a root of its own. */
  onScanFolder: (generation: number, id: number) => void;
  /** Asks to move `ids` of the tree with `generation` to the trash (stable). */
  onTrash: (generation: number, ids: readonly number[]) => void;
  /** The marked rows of the table, whenever they change (stable). */
  onMarks: (ids: readonly number[]) => void;
  /** Roots with a job that runs or waits: nothing of them goes to the trash. */
  busyRoots: ReadonlySet<string>;
  /** A trash request runs. */
  trashing: boolean;
  /** Removes the root from the tree and stops its scan; its saved scan stays. */
  onCloseRoot: (root: string) => void;
  onForget: (root: string) => void;
  onCancelScan: (root: string) => void;
  /** Selects the drive if it is open, else opens its saved scan or queues a scan. */
  onOpenDrive: (mount: string) => void;
  /** Queues a scan of the drive. */
  onScanDrive: (mount: string) => void;
  /** Stable handler for failed requests. */
  onFail: (e: unknown) => void;
}

type MenuState =
  | { kind: "item"; generation: number; target: MenuTarget }
  | { kind: "root"; root: string; x: number; y: number };

/** The folder tree and the drives on the left, the selected root on the right, their menus. */
export function Browser({
  entries,
  selection,
  mode,
  sources,
  progress,
  onSelectNode,
  onSelectRoot,
  onRescan,
  onRefresh,
  onScanFolder,
  onTrash,
  onMarks,
  busyRoots,
  trashing,
  onCloseRoot,
  onForget,
  onCancelScan,
  onOpenDrive,
  onScanDrive,
  onFail,
}: Props) {
  const { t } = useT();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback(
    (generation: number, target: MenuTarget) => setMenu({ kind: "item", generation, target }),
    [],
  );
  // The table sort lives here: it survives folder and root changes.
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const selected = entries.find((e) => e.root === selection?.root);
  const summary = selected?.summary ?? null;
  const roots = useMemo<RootInfo[]>(
    () =>
      entries.map((e) => ({
        root: e.root,
        label: rootLabel(sources, e.root),
        generation: e.summary?.generation ?? null,
        size: e.summary?.total ?? 0,
        rev: e.summary?.rev ?? 0,
        status: e.status,
        drive: isDrive(sources, e.root),
      })),
    [entries, sources],
  );
  const treeTarget = useMemo<TreeTarget | null>(
    () =>
      selection && { root: selection.root, generation: selection.generation, id: selection.folder },
    [selection],
  );
  // Read at render, so an open root menu follows the root's state.
  const menuRoot = menu?.kind === "root" ? roots.find((r) => r.root === menu.root) : undefined;
  // The menu of a root that left the tree, or of an item of a tree that was replaced, is closed,
  // not hidden: it must not come back with the root. Adjusted while rendering, as React recommends for state that follows a prop.
  const itemOpen =
    menu?.kind === "item" && entries.some((e) => e.summary?.generation === menu.generation);
  if ((menu?.kind === "root" && !menuRoot) || (menu?.kind === "item" && !itemOpen)) setMenu(null);
  const itemRoot =
    menu?.kind === "item"
      ? entries.find((e) => e.summary?.generation === menu.generation)?.root
      : undefined;
  const rootMenu: RootMenuTarget | null =
    menu?.kind === "root" && menuRoot
      ? {
          root: menu.root,
          x: menu.x,
          y: menu.y,
          generation: menuRoot.generation,
          status: menuRoot.status,
        }
      : null;

  let content: ReactNode;
  if (!selection) {
    content = <p className="empty-hint dim">{t("empty.hint")}</p>;
  } else if (!selected) {
    // The remembered root is still being reopened: nothing to show yet.
    content = null;
  } else if (!summary) {
    content = (
      <ScanView
        path={selected.root}
        queued={selected.status === "queued"}
        progress={progress?.root === selected.root ? progress : null}
        expected={expectedBytes(sources, selected.root)}
      />
    );
  } else {
    content = (
      <Viewer
        key={summary.generation}
        summary={summary}
        selection={selection}
        mode={mode}
        sort={sort}
        onSort={setSort}
        onSelect={onSelectNode}
        onMenu={openMenu}
        onTrash={onTrash}
        onMarks={onMarks}
        onFail={onFail}
      />
    );
  }

  const tree = (
    <FolderTree
      roots={roots}
      target={treeTarget}
      scanned={progress && { root: progress.root, files: progress.files }}
      sizeHint={summary ? t(`sizeMode.${summary.sizeMode}`) : ""}
      onSelectRoot={onSelectRoot}
      onSelectNode={(generation, id) => onSelectNode(generation, id, true)}
      onItemMenu={openMenu}
      onRootMenu={(root, x, y) => setMenu({ kind: "root", root, x, y })}
      onTrash={onTrash}
      onFail={onFail}
    />
  );

  return (
    <>
      <Workspace
        tree={tree}
        drives={
          <DrivesPanel
            sources={sources}
            roots={entries}
            onOpen={onOpenDrive}
            onScan={onScanDrive}
            onForget={onForget}
          />
        }
        content={content}
      />
      {menu?.kind === "item" && itemOpen && (
        <ItemMenu
          target={menu.target}
          generation={menu.generation}
          canTrash={!trashing && itemRoot !== undefined && !busyRoots.has(itemRoot)}
          onRefresh={onRefresh}
          onScanFolder={onScanFolder}
          onTrash={onTrash}
          onClose={closeMenu}
          onFail={onFail}
        />
      )}
      {rootMenu && (
        <RootMenu
          target={rootMenu}
          onRescan={onRescan}
          onCloseRoot={onCloseRoot}
          onForget={onForget}
          onCancelScan={onCancelScan}
          onClose={closeMenu}
          onFail={onFail}
        />
      )}
    </>
  );
}

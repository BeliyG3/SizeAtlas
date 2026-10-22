import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { QueueEntry, ScanProgress, Sources } from "../api/types";
import { DEFAULT_SORT, type SortState } from "../features/contents/columns";
import { DrivesPanel } from "../features/drives/DrivesPanel";
import { ItemMenu, menuIds, type MenuTarget } from "../features/menu/ItemMenu";
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
import { itemMenuActions } from "./itemActions";
import type { RootEntry } from "./roots";
import type { Selection } from "./selection";
import { availabilityNoteKey, trashAvailability } from "./trashRule";
import { useTrashRefused } from "./useTrashRefused";

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
  /** Roots with a running job: they cannot be scanned again from their menu. */
  busyRoots: ReadonlySet<string>;
  /** The running job: it may keep the items of a menu from the trash (the backend says). */
  job: QueueEntry | null;
  /** Roots inside a running full scan: refresh and child scans are unavailable. */
  fullScans: ReadonlySet<string>;
  /** A trash request runs. */
  trashing: boolean;
  /** The root it moves items of: its folders cannot be refreshed meanwhile. */
  trashingRoot: string | null;
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

const NO_IDS: readonly number[] = [];

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
  job,
  fullScans,
  trashing,
  trashingRoot,
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
  /** Width the drives panel needs: the left pane opens that wide (until its border is moved). */
  const [drivesWidth, setDrivesWidth] = useState(0);
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
        scanning: e.summary?.scanning ?? false,
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

  const itemMenu = menu?.kind === "item" ? menu : null;
  const itemActions = itemMenuActions(entries, itemMenu?.generation, fullScans, trashingRoot);
  const itemRev =
    entries.find((e) => itemMenu && e.summary?.generation === itemMenu.generation)?.summary?.rev ??
    null;
  const menuItems = itemMenu ? menuIds(itemMenu.target) : NO_IDS;
  const refused = useTrashRefused(job, itemMenu?.generation ?? null, itemRev, menuItems);
  const itemTrash = trashAvailability(trashing, job !== null, refused);
  const trashNote =
    itemMenu && availabilityNoteKey(itemTrash, menuItems.length, itemMenu.target.isDir);
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
        query=""
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
            onWidth={setDrivesWidth}
          />
        }
        content={content}
        drivesWidth={drivesWidth}
      />
      {menu?.kind === "item" && itemOpen && (
        <ItemMenu
          target={menu.target}
          generation={menu.generation}
          canTrash={itemTrash.enabled}
          trashNote={trashNote && t(trashNote)}
          canScan={itemActions.scanFolder}
          canRefresh={itemActions.refresh}
          refreshNote={itemActions.refreshNote ? t(itemActions.refreshNote) : null}
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
          canRescan={!busyRoots.has(rootMenu.root)}
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

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ChildrenPage,
  CmdError,
  Crumb,
  Details,
  List,
  ListKind,
  ListOrder,
  Roots,
  ScanError,
  ScanProgress,
  Sources,
  Summary,
  TrashPreview,
  TrashResult,
  TypeStats,
} from "./types";

export function isCmdError(e: unknown): e is CmdError {
  return typeof e === "object" && e !== null && "code" in e;
}

export const api = {
  listSources: () => invoke<Sources>("list_sources"),
  /** Open roots and the scan queue. */
  listRoots: () => invoke<Roots>("list_roots"),
  /** Queues a scan; resolves at once to the canonical root. Progress and failures come as events. */
  scan: (path: string) => invoke<string>("scan", { path }),
  /** Queues a refresh of folder `id` (of a file: its folder); for the root, a full scan. */
  refreshFolder: (generation: number, id: number) =>
    invoke<void>("refresh_folder", { generation, id }),
  /** `id`, or its nearest live ancestor if a change removed it. */
  getLiveAncestor: (generation: number, id: number) =>
    invoke<number>("get_live_ancestor", { generation, id }),
  /** What `trash` would move: the items without those inside another one, their size, the first paths. */
  trashPreview: (generation: number, rev: number, ids: number[]) =>
    invoke<TrashPreview>("trash_preview", { generation, rev, ids }),
  /** Moves items of one tree to the trash; nothing moves if one changed on disk since the scan. */
  trash: (generation: number, rev: number, ids: number[]) =>
    invoke<TrashResult>("trash", { generation, rev, ids }),
  /** Without a root: the running scan. A waiting root leaves the queue. */
  cancelScan: (root?: string) => invoke<void>("cancel_scan", { path: root ?? null }),
  /** Adds the saved scan as a root, or replaces the open one in place. */
  openCached: (root: string) => invoke<Summary>("open_cached", { root }),
  /** Removes a root from the tree and stops its scan; its saved scan stays. */
  closeRoot: (root: string) => invoke<void>("close_root", { root }),
  /** Deletes the saved scan and closes its root. */
  forgetScan: (root: string) => invoke<void>("forget_scan", { root }),
  getSummary: (generation: number) => invoke<Summary>("get_summary", { generation }),
  getChildren: (generation: number, id: number, offset: number, limit: number, order: ListOrder) =>
    invoke<ChildrenPage>("get_children", { generation, id, offset, limit, order }),
  /** Index of `id` in its parent's listing made with `order`; null for the root. */
  getPosition: (generation: number, id: number, order: ListOrder) =>
    invoke<number | null>("get_position", { generation, id, order }),
  /** At most 500 ids per call; the backend ignores the rest. */
  getDetails: (generation: number, ids: number[]) =>
    invoke<Details>("get_details", { generation, ids }),
  /** `rank` of each crumb is its index in its parent's listing made with `order` (default: by name). */
  getCrumbs: (generation: number, id: number, order?: ListOrder) =>
    invoke<Crumb[]>("get_crumbs", order ? { generation, id, order } : { generation, id }),
  getTypeStats: (generation: number, id: number) =>
    invoke<TypeStats>("get_type_stats", { generation, id }),
  /** At most 1000 items below `id` in the order of `kind`; the folder itself is not listed. */
  getList: (generation: number, id: number, kind: ListKind, limit: number) =>
    invoke<List>("get_list", { generation, id, kind, limit }),
  /** Raw bytes; decode with `parseTreemap`. */
  getTreemap: (generation: number, id: number, width: number, height: number) =>
    invoke<ArrayBuffer>("get_treemap", { generation, id, width, height }),
  /** One path per line. */
  copyPaths: (generation: number, ids: number[]) => invoke<void>("copy_paths", { generation, ids }),
  reveal: (generation: number, id: number) => invoke<void>("reveal", { generation, id }),
  /** A file opens in its default program, a folder in the file manager. */
  openItem: (generation: number, id: number) => invoke<void>("open_item", { generation, id }),
  /** The Properties dialog of the system; Windows only. */
  showProperties: (generation: number, id: number) =>
    invoke<void>("show_properties", { generation, id }),
  /** The real path of the item; refused when its name could not be read exactly. */
  itemPath: (generation: number, id: number) => invoke<string>("item_path", { generation, id }),
  /** Whether the app runs as administrator; false off Windows. */
  isElevated: () => invoke<boolean>("is_elevated"),
  /** Starts the app again as administrator to rescan `roots`, then closes this window. Windows only. */
  restartElevated: (roots: string[]) => invoke<void>("restart_elevated", { roots }),
  /** Roots to rescan, named when the app was started; empty after the first call. */
  takeStartupRescans: () => invoke<string[]>("take_startup_rescans"),
  /** Opens the Full Disk Access list in the macOS privacy settings. */
  openPrivacySettings: () => invoke<void>("open_privacy_settings"),
  /**
   * Asks where to save `text` (the Save dialog suggests `suggestedName`) and writes it as UTF-8
   * with a BOM; the saved file's name, or null if the dialog was cancelled.
   */
  exportTable: (suggestedName: string, text: string) =>
    invoke<string | null>("export_table", { suggestedName, text }),
  /** Paints the native title bar dark or light (Windows; elsewhere nothing happens). */
  setTitleBar: (dark: boolean) => invoke<void>("set_title_bar", { dark }),
};

export const onScanProgress = (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
  listen<ScanProgress>("scan-progress", (e) => cb(e.payload));

export const onClosing = (cb: () => void): Promise<UnlistenFn> => listen("closing", () => cb());

export const onRootsChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("roots-changed", () => cb());

export const onLiveTreeChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("live-tree-changed", () => cb());

export const onScanError = (cb: (e: ScanError) => void): Promise<UnlistenFn> =>
  listen<ScanError>("scan-error", (e) => cb(e.payload));

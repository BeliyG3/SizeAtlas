import type { ListKind } from "../../api/types";

/** A flat list the user picks in the mode menu; a search is shown by a query, never picked. */
export type ListMode = Exclude<ListKind, "search">;

/** What the contents table shows: the current folder (all items, or folders only) or a flat list of its subtree. */
export type Mode = "all" | "folders" | ListMode;

/** The key of the old "Folders only" switch: its two values keep their meaning. */
export const MODE_KEY = "sizeatlas.contents.filter";

/** A line of the mode menu: a mode, a submenu of modes, or a separator. */
export type ModeEntry =
  | Mode
  | { readonly submenu: "oldest" | "newest" | "empty"; readonly modes: readonly ListMode[] }
  | "-";

/** The mode menu, laid out as in Folder Size. */
export const MODE_MENU: readonly ModeEntry[] = [
  "all",
  "folders",
  "-",
  "largestFiles",
  "largestFolders",
  "largest",
  "grewMost",
  "-",
  { submenu: "oldest", modes: ["oldestFiles", "oldestFolders", "oldest"] },
  { submenu: "newest", modes: ["newestFiles", "newestFolders", "newest"] },
  { submenu: "empty", modes: ["emptyFolders", "emptyFiles", "empty"] },
  "unreadable",
  "-",
  "longestPaths",
];

export const MODES: readonly Mode[] = MODE_MENU.flatMap<Mode>((entry) =>
  entry === "-" ? [] : typeof entry === "string" ? [entry] : entry.modes,
);

export const parseMode = (raw: string | null): Mode => MODES.find((m) => m === raw) ?? "all";

export const isListMode = (mode: Mode): mode is ListMode => mode !== "all" && mode !== "folders";

/** The flat list the table shows: the search while the query has words, else the mode's list (null: a folder view). */
export const listShown = (mode: Mode, query: string): ListKind | null =>
  query.trim() !== "" ? "search" : isListMode(mode) ? mode : null;

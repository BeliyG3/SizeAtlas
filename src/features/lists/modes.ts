import type { ListKind } from "../../api/types";

/** What the contents table shows: the current folder (all items, or folders only) or a flat list of its subtree. */
export type Mode = "all" | "folders" | ListKind;

/** The key of the old "Folders only" switch: its two values keep their meaning. */
export const MODE_KEY = "sizeatlas.contents.filter";

/** A line of the mode menu: a mode, a submenu of modes, or a separator. */
export type ModeEntry =
  | Mode
  | { readonly submenu: "oldest" | "newest" | "empty"; readonly modes: readonly ListKind[] }
  | "-";

/** The mode menu, laid out as in Folder Size. */
export const MODE_MENU: readonly ModeEntry[] = [
  "all",
  "folders",
  "-",
  "largestFiles",
  "largestFolders",
  "largest",
  "-",
  { submenu: "oldest", modes: ["oldestFiles", "oldestFolders", "oldest"] },
  { submenu: "newest", modes: ["newestFiles", "newestFolders", "newest"] },
  { submenu: "empty", modes: ["emptyFolders", "emptyFiles", "empty"] },
  "-",
  "longestPaths",
];

export const MODES: readonly Mode[] = MODE_MENU.flatMap<Mode>((entry) =>
  entry === "-" ? [] : typeof entry === "string" ? [entry] : entry.modes,
);

export const parseMode = (raw: string | null): Mode => MODES.find((m) => m === raw) ?? "all";

export const isListMode = (mode: Mode): mode is ListKind => mode !== "all" && mode !== "folders";

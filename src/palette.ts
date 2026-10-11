import type { Theme } from "./settings/settings";

/** File categories in the order of `Category` in core/src/categories.rs: the index is the value. */
export const CATEGORY_NAMES = [
  "Video",
  "Images",
  "Audio",
  "Documents",
  "Archives",
  "Code",
  "Executables",
  "Other",
] as const;

/** Colors for canvas and SVG, which cannot use CSS variables. */
export interface Palette {
  /** One per category, by category value. */
  categories: readonly string[];
  /** Pie and bar slices, largest first. */
  slices: readonly string[];
  /** The "Other" slice. */
  other: string;
  dirFill: string;
  dirBorder: string;
  fileEdge: string;
  selectedEdge: string;
}

export const PALETTES: Readonly<Record<Theme, Palette>> = {
  dark: {
    categories: [
      "#e2605b",
      "#4fb38b",
      "#d9a441",
      "#5b9dff",
      "#a77de8",
      "#4cc3d9",
      "#e57fb5",
      "#7c8494",
    ],
    slices: [
      "#5b9dff",
      "#e2605b",
      "#4fb38b",
      "#d9a441",
      "#a77de8",
      "#4cc3d9",
      "#e57fb5",
      "#9bc53d",
      "#f08a4b",
      "#8e9aaf",
    ],
    other: "#4a4f5c",
    dirFill: "#20232b",
    dirBorder: "#3a3f4b",
    fileEdge: "rgb(0 0 0 / 35%)",
    selectedEdge: "#ffffff",
  },
  light: {
    categories: [
      "#d64541",
      "#2e9b6f",
      "#c08a1e",
      "#3b7ddd",
      "#8a5cd1",
      "#1fa2bb",
      "#cc5c98",
      "#6b7280",
    ],
    slices: [
      "#3b7ddd",
      "#d64541",
      "#2e9b6f",
      "#c08a1e",
      "#8a5cd1",
      "#1fa2bb",
      "#cc5c98",
      "#6f9a1f",
      "#d9692b",
      "#5d6b82",
    ],
    other: "#b8bdc7",
    dirFill: "#eceff3",
    dirBorder: "#c3c9d2",
    fileEdge: "rgb(255 255 255 / 55%)",
    selectedEdge: "#111111",
  },
};

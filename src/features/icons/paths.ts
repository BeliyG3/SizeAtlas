/**
 * Line icons on a 16×16 grid, drawn with a 1.5 stroke, round caps and joins and no fill
 * (see Icon). Each is one path; a dot is a zero-length line, which the round cap makes round.
 */

/** A folder with its tab, the base of the folder icons; its body spans y 4.5 to 13. */
const FOLDER =
  "M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z";
/** A page with a folded corner. */
const PAGE = "M3.5 1.5h5.5l3.5 3.5v9.5h-9zM9 1.5V5h3.5";

export const ICONS = {
  back: "M13 8H3M7 4L3 8l4 4",
  forward: "M3 8h10M9 4l4 4-4 4",
  refresh: "M13.5 8A5.5 5.5 0 1 1 11.9 4.1M9.2 4.1h2.7V1.4",
  cancel: "M4 4l8 8M12 4l-8 8",
  forget: "M6.5 13.5l-4-4 6-6 4 4zM5.5 6.5l4 4M6.5 13.5h7",
  list: "M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.01M2.5 8h.01M2.5 12h.01",
  "chevron-down": "M4.5 6.5L8 10l3.5-3.5",
  "chevron-right": "M6.5 4.5L10 8l-3.5 3.5",
  pie: "M12.5 8.5A5 5 0 1 1 7.5 3.5v5zM9 2v5h5a5 5 0 0 0-5-5z",
  bars: "M2.5 13.5h11M5 11.5V8M8 11.5V3.5M11 11.5V6",
  treemap: "M2.5 2.5h11v11h-11zM8 2.5v11M8 8h5.5M10.75 8v5.5",
  "file-types":
    "M2.5 2.5h4.5V7H2.5zM13.5 4.75a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 1 1 4.5 0zM4.75 9L7 13.5H2.5zM9 9h4.5v4.5H9z",
  globe:
    "M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 1 1 11 0zM2.5 8h11M8 2.5a2.5 5.5 0 0 1 0 11 2.5 5.5 0 0 1 0-11z",
  largest: "M2.5 4h11M2.5 8h8M2.5 12h5",
  folder: FOLDER,
  "folder-open": "M1.5 13V4a1 1 0 0 1 1-1h3.5l1.5 1.5h5a1 1 0 0 1 1 1V7M1.5 13L4 7h10.5L12 13z",
  drive:
    "M1.5 9h13v3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM1.5 9l2.1-5.4a1 1 0 0 1 .9-.6h7a1 1 0 0 1 .9.6L14.5 9M11.5 11h.01M9 11h.01",
  "network-drive": "M2.5 2.5h11V8h-11zM11 5.25h.01M8 8v3M3 13v-2h10v2",
  file: PAGE,
  video: "M1.5 3.5h13v9h-13zM6.5 6l3.5 2-3.5 2z",
  image: "M1.5 2.5h13v11h-13zM1.5 11L5 7.5l3 3 2-2 4.5 4.5M11.5 5.5a1 1 0 1 1-2 0 1 1 0 1 1 2 0z",
  audio:
    "M6 12V3.5L13 2v8.5M6 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0zM13 10.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0z",
  document: `${PAGE}M5.5 8h5M5.5 10.5h5M5.5 13h3`,
  archive: "M2 5.5h12v8H2zM1.5 2.5h13v3h-13zM6.5 8.5h3",
  code: "M5 4.5L1.5 8 5 11.5M11 4.5L14.5 8 11 11.5M9.5 3l-3 10",
  executable: "M1.5 2.5h13v11h-13zM1.5 5.5h13M4.5 8l2 1.75-2 1.75",
  trash: "M2.5 4h11M6 4V2.5h4V4M3.75 4l.75 9.5h7l.75-9.5M6.5 6.5V11M9.5 6.5V11",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  reveal: `${FOLDER}M6.5 11L10 7.5M7 7.5h3v3`,
  open: "M12.5 9v4.5h-9v-9H7M9.5 2.5h4v4M13.5 2.5L8 8",
  properties:
    "M2.5 4h6M12.5 4h1M2.5 8h1M7.5 8h6M2.5 12h5M11.5 12h2M10.5 2.5v3M5.5 6.5v3M9.5 10.5v3",
  "scan-folder": `${FOLDER}M9.25 8.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 1 1 3.5 0zM9 10l1.75 1.75`,
  "choose-folder": `${FOLDER}M8 6.5V11M5.75 8.75h4.5`,
  scan: "M11 11l3.5 3.5M12 7A5 5 0 1 1 2 7a5 5 0 1 1 10 0z",
  info: "M14.5 8a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0zM8 7.5v4M8 5h.01",
  export: "M8 2v8M5 7l3 3 3-3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2",
  exit: "M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 5l3 3-3 3M13.5 8h-7",
} as const;

export type IconName = keyof typeof ICONS;

/** The icon of a file, by category value (the order of CATEGORY_NAMES in palette.ts). */
export const CATEGORY_ICONS: readonly IconName[] = [
  "video",
  "image",
  "audio",
  "document",
  "archive",
  "code",
  "executable",
  "file",
];

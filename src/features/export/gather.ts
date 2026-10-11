import { api } from "../../api/client";
import type { Detail, Item, ListItem } from "../../api/types";
import { COLUMNS } from "../contents/columns";
import { joinPath } from "./names";
import type { ExportSource } from "./source";

/** Rows per request: few enough requests for a huge folder, each one sorts the folder again. */
export const PAGE = 20_000;
/** The backend reads details of at most this many ids per call (MAX_DETAILS). */
const DETAILS_BATCH = 500;
/** Reads of a folder that a change of the tree may restart before the export gives up. */
export const ATTEMPTS = 3;

const DETAIL_COLUMNS = new Set(COLUMNS.filter((c) => c.detail).map((c) => c.id));

/** The tree changed while it was read, so the rows could mix two revisions. */
export class TreeChanged extends Error {
  constructor() {
    super("The tree changed during the export");
    this.name = "TreeChanged";
  }
}

export interface Gathered {
  items: readonly (Item | ListItem)[];
  details: ReadonlyMap<number, Detail>;
  folderSize: number;
  /** Name of the listed folder (a root's is its path). */
  folderName: string;
  pathOf: (item: Item | ListItem) => string;
}

/** Every item of the folder in `order`, all from one revision of the tree; null if it changed. */
async function readFolder(source: Extract<ExportSource, { kind: "folder" }>) {
  const all: Item[] = [];
  let total = Infinity;
  let rev: number | null = null;
  let size = 0;
  while (all.length < total) {
    const page = await api.getChildren(
      source.generation,
      source.folder,
      all.length,
      PAGE,
      source.order,
    );
    if (rev !== null && page.rev !== rev) return null;
    rev = page.rev;
    total = page.total;
    size = page.size;
    if (page.items.length === 0) break;
    all.push(...page.items);
  }
  return { items: all, size, rev: rev ?? 0 };
}

/** One read of the table; null if the tree changed meanwhile. */
async function gatherOnce(source: ExportSource): Promise<Gathered | null> {
  const { generation } = source;
  const folder = source.kind === "folder" ? source.folder : source.base;
  const crumbs = await api.getCrumbs(generation, folder);
  const folderPath = joinPath(crumbs.map((c) => c.name));

  let items: readonly (Item | ListItem)[];
  let folderSize: number;
  let rev: number;
  if (source.kind === "folder") {
    const read = await readFolder(source);
    if (!read) return null;
    ({ items, size: folderSize, rev } = read);
  } else {
    ({ rows: items, size: folderSize, rev } = source);
  }

  const details = new Map<number, Detail>();
  if (source.columns.some((c) => DETAIL_COLUMNS.has(c))) {
    for (let i = 0; i < items.length; i += DETAILS_BATCH) {
      const ids = items.slice(i, i + DETAILS_BATCH).map((item) => item.id);
      for (const d of (await api.getDetails(generation, ids)).items) details.set(d.id, d);
    }
  }
  if ((await api.getSummary(generation)).rev !== rev) return null;

  return {
    items,
    details,
    folderSize,
    folderName: crumbs.at(-1)?.name ?? "",
    pathOf: (item) => joinPath([folderPath, "folder" in item ? item.folder : "", item.name]),
  };
}

/**
 * Every row of the table, not only those loaded: all items of the folder in the table's order,
 * or the rows of the list; with details read from disk when a detail column is shown. A change
 * of the tree meanwhile reads a folder again (up to ATTEMPTS times); a list cannot be read again
 * here, its table lists anew. Throws TreeChanged when that does not settle.
 */
// ponytail: requests run one after another with no progress shown; a folder of 300 000 items
// with a detail column visible reads 600 batches from disk. Add progress if that gets slow.
export async function gather(source: ExportSource): Promise<Gathered> {
  const attempts = source.kind === "folder" ? ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const gathered = await gatherOnce(source);
    if (gathered) return gathered;
  }
  throw new TreeChanged();
}

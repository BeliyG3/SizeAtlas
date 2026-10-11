import { api } from "../../api/client";
import type { Detail, Item, ListItem } from "../../api/types";
import { COLUMNS } from "../contents/columns";
import { joinPath } from "./names";
import type { ExportSource } from "./source";

/** Rows per request: few enough requests for a huge folder, each one sorts the folder again. */
export const PAGE = 20_000;
/** A live folder is read in one backend snapshot, including its exact sort order. */
export const LIVE_LIMIT = 0xffff_ffff;
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

/** Live reads use one snapshot: changing sort positions cannot skip or duplicate rows. */
async function readFolder(source: Extract<ExportSource, { kind: "folder" }>, scanning: boolean) {
  if (scanning) {
    const page = await api.getChildren(
      source.generation,
      source.folder,
      0,
      LIVE_LIMIT,
      source.order,
    );
    return { items: page.items, size: page.size, rev: page.rev };
  }
  const all = new Map<number, Item>();
  let offset = 0;
  let total = Infinity;
  let rev: number | null = null;
  let size = 0;
  while (offset < total) {
    const page = await api.getChildren(
      source.generation,
      source.folder,
      offset,
      PAGE,
      source.order,
    );
    if (rev !== null && page.rev !== rev) return null;
    rev = page.rev;
    total = page.total;
    size = page.size;
    if (page.items.length === 0) break;
    offset += page.items.length;
    for (const item of page.items) all.set(item.id, item);
  }
  return { items: [...all.values()], size, rev: rev ?? 0 };
}

/** One read of the table; null if the tree changed meanwhile. */
async function gatherOnce(source: ExportSource): Promise<Gathered | null> {
  const { generation } = source;
  // A first scan keeps ids stable while its revisions grow.
  const initial = await api.getSummary(generation);
  const scanning = initial.scanning === true;
  const folder = source.kind === "folder" ? source.folder : source.base;
  const crumbs = await api.getCrumbs(generation, folder);
  const folderPath = joinPath(crumbs.map((c) => c.name));

  let items: readonly (Item | ListItem)[];
  let folderSize: number;
  let rev: number;
  let mixedRevisions = false;
  if (source.kind === "folder") {
    const read = await readFolder(source, scanning);
    if (!read) return null;
    ({ items, size: folderSize, rev } = read);
  } else {
    ({ rows: items, size: folderSize, rev } = source);
    if (scanning) {
      const latest = await api.getList(generation, source.base, source.list, source.rows.length);
      const byId = new Map(latest.items.map((item) => [item.id, item]));
      const parents = new Map<number, Promise<{ rev: number; items: ReadonlyMap<number, Item> }>>();
      // Keep the table's selected order; refresh every field of rows displaced from a capped list.
      items = await Promise.all(
        source.rows.map(async (item) => {
          const current = byId.get(item.id);
          if (current) return current;
          if (!parents.has(item.parent)) {
            parents.set(
              item.parent,
              api
                .getChildren(generation, item.parent, 0, LIVE_LIMIT, {
                  key: "name",
                  descending: false,
                  dirsOnly: false,
                })
                .then((page) => ({
                  rev: page.rev,
                  items: new Map(page.items.map((row) => [row.id, row])),
                })),
            );
          }
          const page = await parents.get(item.parent)!;
          mixedRevisions ||= page.rev !== latest.rev;
          const refreshed = page.items.get(item.id);
          if (!refreshed) throw new TreeChanged();
          return { ...item, ...refreshed };
        }),
      );
      folderSize = latest.size;
      rev = latest.rev;
    }
  }

  const details = new Map<number, Detail>();
  if (source.columns.some((c) => DETAIL_COLUMNS.has(c))) {
    for (let i = 0; i < items.length; i += DETAILS_BATCH) {
      const ids = items.slice(i, i + DETAILS_BATCH).map((item) => item.id);
      for (const d of (await api.getDetails(generation, ids)).items) details.set(d.id, d);
    }
  }
  // All reads precede validation, including the live subfolder's current denominator.
  const liveSize =
    scanning && folder !== initial.rootId
      ? (await api.getCrumbs(generation, folder)).at(-1)?.size
      : undefined;
  const summary = await api.getSummary(generation);
  // Completion restores strict checks: later edits may remove or replace these ids.
  if ((!scanning || !summary.scanning) && (mixedRevisions || summary.rev !== rev)) return null;
  if (scanning && summary.scanning) {
    folderSize = folder === summary.rootId ? summary.total : (liveSize ?? folderSize);
  }

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
 * here, its table lists anew. First scans accept growing revisions and refresh list sizes.
 * Throws TreeChanged when a non-live tree does not settle.
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

import {
  ROOT_ID,
  type ChildrenPage,
  type Crumb,
  type Item,
  type RootStatus,
} from "../../api/types";

export const PAGE_SIZE = 200;

/** Rows moved by PageUp and PageDown. */
const PAGE_JUMP = 20;

/** The tree lists folders only: a folder can be expanded when it has subfolders. */
export const canExpand = (item: Item) => item.isDir && item.folders > 0;

/** Children of one folder loaded so far. */
export interface Loaded {
  items: Item[];
  total: number;
  restCount: number;
  restSize: number;
  generation: number;
  rev: number;
}

/** Loaded children by the generation of their root, then by folder id. */
export type LoadedRoots = ReadonlyMap<number, ReadonlyMap<number, Loaded>>;

const NO_PAGES: ReadonlyMap<number, Loaded> = new Map();

/** The loaded children of one root. */
export const pagesOf = (loaded: LoadedRoots, generation: number): ReadonlyMap<number, Loaded> =>
  loaded.get(generation) ?? NO_PAGES;

/** Adds a page of folder `id` of the root with `generation`; other roots stay as they are. */
export function withPage(
  loaded: LoadedRoots,
  generation: number,
  id: number,
  page: ChildrenPage,
  offset: number,
): LoadedRoots {
  const pages = pagesOf(loaded, generation);
  const next = new Map(pages).set(id, mergePage(pages.get(id), page, offset));
  return new Map(loaded).set(generation, next);
}

/**
 * After a change of the tree (a refresh, a trash): the folders of an older revision to load
 * again — the root and the open ones, from the top, as many rows as they show — and those to drop:
 * closed ones load when they open.
 */
export function reloadPlan(
  pages: ReadonlyMap<number, Loaded>,
  rev: number,
  open: (id: number) => boolean,
): { requests: PageRequest[]; drop: number[] } {
  const requests: PageRequest[] = [];
  const drop: number[] = [];
  for (const [id, loaded] of pages) {
    if (loaded.rev >= rev) continue;
    if (id !== ROOT_ID && !open(id)) {
      drop.push(id);
      continue;
    }
    const limit = Math.max(PAGE_SIZE, Math.ceil(loaded.items.length / PAGE_SIZE) * PAGE_SIZE);
    requests.push({ id, offset: 0, limit });
  }
  return { requests, drop };
}

/** Forgets folders `ids` of the root with `generation`: a change removed or outdated them. */
export function withoutFolders(
  loaded: LoadedRoots,
  generation: number,
  ids: readonly number[],
): LoadedRoots {
  const pages = pagesOf(loaded, generation);
  if (!ids.some((id) => pages.has(id))) return loaded;
  const next = new Map(pages);
  for (const id of ids) next.delete(id);
  return new Map(loaded).set(generation, next);
}

/** A root row of the tree: an open root, or one that waits for its first scan. */
export interface RootInfo {
  /** Canonical path: the identity of the row. */
  root: string;
  /** "Data (T:)" for a drive with a label, else the path. */
  label: string;
  /** Null until its first scan or saved scan is open. */
  generation: number | null;
  /** Total size on disk; unused without a tree. */
  size: number;
  /** Revision of the tree: a change loads its expanded folders again. */
  rev: number;
  status: RootStatus;
  /** The root of a drive rather than a folder. */
  drive: boolean;
}

export type Row =
  | { kind: "root"; info: RootInfo; depth: 0; expanded: boolean; expandable: boolean }
  | {
      kind: "item";
      generation: number;
      item: Item;
      depth: number;
      parentSize: number;
      expanded: boolean;
    }
  | {
      kind: "more";
      generation: number;
      parentId: number;
      depth: number;
      restCount: number;
      restSize: number;
    };

/** Key of a folder: ids repeat across roots, generations never do. */
export const nodeKey = (generation: number, id: number) => `${generation}:${id}`;

/** Key of a root row; encoded, because paths hold spaces and quotes and keys go into DOM ids. */
export const rootKey = (root: string) => `root:${encodeURIComponent(root)}`;

/** Stable identity of a row: used for focus, React keys and DOM ids. */
export function rowKey(row: Row): string {
  switch (row.kind) {
    case "root":
      return rootKey(row.info.root);
    case "item":
      return nodeKey(row.generation, row.item.id);
    case "more":
      return `more-${nodeKey(row.generation, row.parentId)}`;
  }
}

/**
 * Adds a page at `offset`; a page of a newer revision replaces what was loaded, a page of an older
 * one (an answer that arrived late) is dropped.
 */
export function mergePage(
  previous: Loaded | undefined,
  page: ChildrenPage,
  offset: number,
): Loaded {
  if (previous && previous.generation === page.generation && page.rev < previous.rev) {
    return previous;
  }
  const same = previous?.generation === page.generation && previous.rev === page.rev;
  const kept = same ? previous.items.slice(0, offset) : [];
  // An older answer must not drop rows loaded beyond it (e.g. revealed while it was in flight).
  const tail = same ? previous.items.slice(offset + page.items.length) : [];
  const rest = same && tail.length > 0 ? previous : page;
  return {
    items: [...kept, ...page.items, ...tail],
    total: page.total,
    restCount: rest.restCount,
    restSize: rest.restSize,
    generation: page.generation,
    rev: page.rev,
  };
}

/**
 * Visible rows: every root in order, each followed by the children of its expanded folders
 * (the root included unless collapsed), depth-first. `expanded` holds `nodeKey`s of folders,
 * `collapsed` the paths of collapsed roots: roots start expanded.
 */
export function buildRows(
  roots: readonly RootInfo[],
  loaded: LoadedRoots,
  expanded: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
): Row[] {
  const rows: Row[] = [];
  const visit = (
    pages: ReadonlyMap<number, Loaded>,
    generation: number,
    id: number,
    size: number,
    depth: number,
  ) => {
    const children = pages.get(id);
    if (!children) return;
    for (const item of children.items) {
      const open = item.isDir && expanded.has(nodeKey(generation, item.id));
      rows.push({ kind: "item", generation, item, depth, parentSize: size, expanded: open });
      if (open) visit(pages, generation, item.id, item.size, depth + 1);
    }
    if (children.restCount > 0) {
      rows.push({
        kind: "more",
        generation,
        parentId: id,
        depth,
        restCount: children.restCount,
        restSize: children.restSize,
      });
    }
  };
  for (const info of roots) {
    const pages = info.generation === null ? NO_PAGES : pagesOf(loaded, info.generation);
    // Expandable until its folders are known to be none; a root without a tree has none.
    const expandable = info.generation !== null && pages.get(ROOT_ID)?.total !== 0;
    const open = expandable && !collapsed.has(info.root);
    rows.push({ kind: "root", info, depth: 0, expanded: open, expandable });
    if (open && info.generation !== null) visit(pages, info.generation, ROOT_ID, info.size, 1);
  }
  return rows;
}

/** A target needs revealing unless its row is focused and visible already. */
export function shouldReveal(focusKey: string | null, rows: readonly Row[], key: string): boolean {
  return focusKey !== key || !rows.some((row) => rowKey(row) === key);
}

/** The row index a navigation key moves the focus to, kept in the list; undefined for other keys. */
export function keyTarget(key: string, index: number, count: number): number | undefined {
  const moves: Record<string, number> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    PageDown: index + PAGE_JUMP,
    PageUp: index - PAGE_JUMP,
    Home: 0,
    End: count - 1,
  };
  if (!Object.hasOwn(moves, key)) return undefined;
  return Math.max(0, Math.min(count - 1, moves[key]));
}

export interface PageRequest {
  id: number;
  offset: number;
  limit: number;
}

/**
 * Pages to load so that every folder on the path lists the next node of the path.
 * `crumbs` run from the root to the target; each carries its rank among its siblings.
 */
export function pagesToReveal(
  loaded: ReadonlyMap<number, Loaded>,
  crumbs: readonly Crumb[],
  pageSize: number,
): PageRequest[] {
  const requests: PageRequest[] = [];
  for (let i = 1; i < crumbs.length; i++) {
    const parent = crumbs[i - 1].id;
    const have = loaded.get(parent)?.items.length ?? 0;
    const need = crumbs[i].rank + 1;
    if (need > have) {
      requests.push({
        id: parent,
        offset: have,
        limit: Math.ceil((need - have) / pageSize) * pageSize,
      });
    }
  }
  return requests;
}

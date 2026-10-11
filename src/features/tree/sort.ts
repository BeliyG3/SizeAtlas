import type { ListOrder } from "../../api/types";

/** The tree sorts by name or by size on disk. */
export type TreeSortKey = "name" | "size";

export interface TreeSort {
  key: TreeSortKey;
  descending: boolean;
}

export const TREE_SORT_KEY = "sizeatlas.tree.sort";

export const DEFAULT_TREE_SORT: TreeSort = { key: "name", descending: false };

export const serializeTreeSort = (sort: TreeSort) =>
  `${sort.key}:${sort.descending ? "desc" : "asc"}`;

/** A stored sort; anything unknown gives the default. */
export function parseTreeSort(raw: string | null): TreeSort {
  const [key, direction] = (raw ?? "").split(":");
  return (key === "name" || key === "size") && (direction === "asc" || direction === "desc")
    ? { key, descending: direction === "desc" }
    : DEFAULT_TREE_SORT;
}

/** A header click: the active column flips; another starts in its natural direction. */
export function nextTreeSort(current: TreeSort, key: TreeSortKey): TreeSort {
  return key === current.key
    ? { key, descending: !current.descending }
    : { key, descending: key === "size" };
}

/** The listing order for pages and ranks: folders only. */
export const treeOrder = (sort: TreeSort): ListOrder => ({ ...sort, dirsOnly: true });

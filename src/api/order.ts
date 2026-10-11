import type { ListOrder } from "./types";

/** Largest on disk first, files and folders together. */
export const DEFAULT_ORDER: ListOrder = { key: "size", descending: true, dirsOnly: false };

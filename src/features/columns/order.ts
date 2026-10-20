/**
 * `order` with column `id` moved before column `before` (null: to the end). A `pinned` column
 * stays first: it does not move and nothing goes before it.
 */
export function moveColumn<K extends string>(
  order: readonly K[],
  id: K,
  before: K | null,
  pinned?: K,
): K[] {
  if (id === pinned || id === before) return [...order];
  const rest = order.filter((c) => c !== id);
  const first = pinned === undefined ? 0 : 1;
  const at = before === null ? rest.length : Math.max(first, rest.indexOf(before));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** A stored order without what a user could have broken: known ids once, missing ones appended. */
export function repairOrder<K extends string>(stored: unknown, defaults: readonly K[]): K[] {
  const known = new Set<string>(defaults);
  const kept = Array.isArray(stored)
    ? [...new Set(stored.filter((id): id is K => typeof id === "string" && known.has(id)))]
    : [];
  return [...kept, ...defaults.filter((id) => !kept.includes(id))];
}

/** An order stored as a JSON array; garbage gives `defaults`. */
export function parseOrder<K extends string>(raw: string | null, defaults: readonly K[]): K[] {
  try {
    return repairOrder(raw === null ? null : JSON.parse(raw), defaults);
  } catch {
    return [...defaults];
  }
}

export const serializeOrder = (order: readonly string[]) => JSON.stringify(order);

/**
 * Where a dragged header lands: the number of columns whose center is before `x` (left of it, or
 * right of it in right-to-left layouts).
 */
export const dropIndex = (centers: readonly number[], x: number, rtl: boolean) =>
  centers.filter((center) => (rtl ? center > x : center < x)).length;

/** Where the line of drop index `at` goes: the start edge of that column, or the end of the last. */
export function dropEdge(
  boxes: readonly Pick<DOMRect, "left" | "right">[],
  at: number,
  rtl: boolean,
): number {
  if (at < boxes.length) return rtl ? boxes[at].right : boxes[at].left;
  const last = boxes[boxes.length - 1];
  return rtl ? last.left : last.right;
}

/**
 * Left edge of the ghost of a dragged header: it follows the pointer at `x`, held `grab` pixels
 * from its left edge, and stays between `left` and `right`, the edges of the header.
 */
export const ghostLeft = (x: number, grab: number, width: number, left: number, right: number) =>
  Math.max(left, Math.min(right - width, x - grab));

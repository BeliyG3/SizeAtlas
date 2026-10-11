/** Height of a table row and of the header, in pixels; keep in sync with contents.css. */
export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 24;
/** Rows per request, as in the folder tree. */
export const PAGE_SIZE = 200;
/** Rows rendered and fetched beyond the visible ones on each side. */
export const OVERSCAN = 20;

/** Rows `[first, last)` to render; `viewport` is the height of the area under the header. */
// ponytail: one absolutely positioned box per row; browsers cap element height at about
// 33 million px (1.4 million rows). Scale the scroll range if folders ever get that big.
export function visibleRange(
  scrollTop: number,
  viewport: number,
  count: number,
): { first: number; last: number } {
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const first = Math.min(last, Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  return { first, last };
}

/** Pages that hold rows `[first, last)`. */
export function pagesFor(first: number, last: number): number[] {
  const pages: number[] = [];
  for (let page = Math.floor(first / PAGE_SIZE); page * PAGE_SIZE < last; page++) pages.push(page);
  return pages;
}

/** Scroll position that brings row `index` into view, or null if it is visible already. */
export function scrollToShow(index: number, scrollTop: number, viewport: number): number | null {
  const top = index * ROW_HEIGHT;
  if (top < scrollTop) return top;
  if (top + ROW_HEIGHT > scrollTop + viewport) return top + ROW_HEIGHT - viewport;
  return null;
}

/** Row a navigation key moves the cursor to from row `at` (not clamped), or null for other keys. */
export function rowTarget(key: string, at: number, pageRows: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return at + 1;
    case "ArrowUp":
      return at - 1;
    case "PageDown":
      return at + pageRows;
    case "PageUp":
      return at - pageRows;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

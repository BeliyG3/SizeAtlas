/** Width limits of any resizable column, in pixels. */
export const MIN_WIDTH = 48;
export const MAX_WIDTH = 2000;

/** Added to a measured width: sub-pixel rounding must not bring the ellipsis back. */
const FIT_SLACK = 4;
/** Pixels an arrow key moves a column border by (Shift: more). */
const STEP = 8;
const BIG_STEP = 32;

export const clampWidth = (width: number) =>
  Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

/** Width that shows content `measured` pixels wide (padding included) without cutting it. */
export const fitWidth = (measured: number) => clampWidth(Math.ceil(measured) + FIT_SLACK);

/** How far on screen (right: positive) a key moves a column border, or null for other keys. */
export function resizeStep(key: string, shift: boolean): number | null {
  const step = shift ? BIG_STEP : STEP;
  if (key === "ArrowLeft") return -step;
  if (key === "ArrowRight") return step;
  return null;
}

/**
 * Width of a column after its border on the `side` edge ("left": inline-start, "right":
 * inline-end) moved `delta` pixels on screen. In right-to-left layouts the inline-end is the left.
 */
export function dragWidth(
  width: number,
  delta: number,
  side: "left" | "right",
  rtl: boolean,
): number {
  const outwards = (side === "right") !== rtl ? delta : -delta;
  return clampWidth(width + outwards);
}

/** The usable stored widths of the columns of `defaults`; unknown columns and bad values are left out. */
export function storedWidths<K extends string>(
  raw: string | null,
  defaults: Readonly<Record<K, number>>,
): Partial<Record<K, number>> {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    // Garbage in storage: nothing stored.
  }
  const widths: Partial<Record<K, number>> = {};
  if (stored !== null && typeof stored === "object" && !Array.isArray(stored)) {
    for (const id of Object.keys(defaults) as K[]) {
      const value = (stored as Record<string, unknown>)[id];
      if (typeof value === "number" && value >= MIN_WIDTH && value <= MAX_WIDTH) {
        widths[id] = Math.round(value);
      }
    }
  }
  return widths;
}

/** Stored widths over `defaults`. */
export const parseWidths = <K extends string>(
  raw: string | null,
  defaults: Readonly<Record<K, number>>,
): Record<K, number> => ({ ...defaults, ...storedWidths(raw, defaults) });

/**
 * The width of each column: one the user set (stored) wins over one fitted to the content in the
 * current language, which wins over the fixed default. A stored width equal to the default counts
 * as none: Fit and Reset once stored every column.
 */
export const columnWidths = <K extends string>(
  defaults: Readonly<Record<K, number>>,
  fitted: Partial<Record<K, number>>,
  stored: Partial<Record<K, number>>,
): Record<K, number> => {
  const set = Object.entries(stored).filter(([id, width]) => width !== defaults[id as K]);
  return { ...defaults, ...fitted, ...Object.fromEntries(set) };
};

/**
 * Natural width of the widest rendered cell of column `col` (elements with `data-col`, the
 * header included), padding included. Event handlers only: it forces one layout.
 */
export function measureColumn(root: ParentNode | null, col: string): number {
  const cells = [...(root?.querySelectorAll<HTMLElement>(`[data-col="${col}"]`) ?? [])];
  // Out of the grid or table and sized to their content; put back before anything paints.
  const saved = cells.map((cell) => cell.style.cssText);
  for (const cell of cells) {
    cell.style.position = "absolute";
    cell.style.width = "max-content";
    cell.style.maxWidth = "none";
  }
  const widest = cells.reduce((max, cell) => Math.max(max, cell.getBoundingClientRect().width), 0);
  cells.forEach((cell, i) => (cell.style.cssText = saved[i]));
  return widest;
}

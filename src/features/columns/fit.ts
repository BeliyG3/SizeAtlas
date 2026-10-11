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

/** Change of width for a key pressed on a column border, or null for other keys. */
export function resizeStep(key: string, shift: boolean): number | null {
  const step = shift ? BIG_STEP : STEP;
  if (key === "ArrowLeft") return -step;
  if (key === "ArrowRight") return step;
  return null;
}

/** Stored widths over `defaults`; unknown columns and unusable values are ignored. */
export function parseWidths<K extends string>(
  raw: string | null,
  defaults: Readonly<Record<K, number>>,
): Record<K, number> {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    // Garbage in storage: use the defaults.
  }
  const widths: Record<K, number> = { ...defaults };
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

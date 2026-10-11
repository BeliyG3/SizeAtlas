import type { Item } from "../../api/types";
import type { Palette } from "../../palette";

/** Largest children shown one by one; the rest form "Other". */
export const TOP_SLICES = 10;

export interface Slice {
  /** null for "Other". */
  id: number | null;
  name: string;
  size: number;
  isDir: boolean;
  /** Where the slice starts and how much it takes, as parts of the whole (0…1). */
  start: number;
  share: number;
  color: string;
}

/** Slices of a folder from its largest children (on disk) and the size of all the others. */
export function buildSlices(
  items: readonly Item[],
  restSize: number,
  palette: Palette,
  otherName: string,
): Slice[] {
  const total = items.reduce((sum, i) => sum + i.size, 0) + restSize;
  if (total <= 0) return [];
  const parts = items
    .filter((i) => i.size > 0)
    .map((i, k) => ({
      id: i.id as number | null,
      name: i.name,
      size: i.size,
      isDir: i.isDir,
      color: palette.slices[k % palette.slices.length],
    }));
  if (restSize > 0) {
    parts.push({ id: null, name: otherName, size: restSize, isDir: false, color: palette.other });
  }
  const slices: Slice[] = [];
  let start = 0;
  for (const part of parts) {
    const share = part.size / total;
    slices.push({ ...part, start, share });
    start += share;
  }
  return slices;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** SVG path of a pie slice from `start` to `end` (parts of a turn, clockwise from 12 o'clock). */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  if (end - start >= 0.9999) {
    // A single arc cannot draw a whole circle.
    const left = round(cx - r);
    const right = round(cx + r);
    return `M ${left} ${cy} A ${r} ${r} 0 1 1 ${right} ${cy} A ${r} ${r} 0 1 1 ${left} ${cy} Z`;
  }
  const point = (turn: number) => {
    const angle = 2 * Math.PI * turn - Math.PI / 2;
    return `${round(cx + r * Math.cos(angle))} ${round(cy + r * Math.sin(angle))}`;
  };
  const large = end - start > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${point(start)} A ${r} ${r} 0 ${large} 1 ${point(end)} Z`;
}

import type { Palette } from "../../palette";
import type { TreemapRect } from "./bytes";

export interface DrawOptions {
  /** Category to emphasize; files of other categories are dimmed. */
  highlight: number | null;
  /** Node to outline. */
  selected: number | null;
  /** Colors of the current theme. */
  palette: Palette;
}

const DIMMED = 0.2;

/** Paints the treemap in CSS pixels; the caller has already scaled the context for the device. */
export function drawTreemap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rects: readonly TreemapRect[],
  { highlight, selected, palette }: DrawOptions,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  for (const r of rects) {
    if (r.isDir) {
      ctx.fillStyle = palette.dirFill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = palette.dirBorder;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      continue;
    }
    ctx.globalAlpha = highlight === null || highlight === r.category ? 1 : DIMMED;
    ctx.fillStyle = palette.categories[r.category] ?? palette.categories[7];
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
    if (r.w > 3 && r.h > 3) {
      ctx.strokeStyle = palette.fileEdge;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
  }
  const outlined = selected === null ? undefined : rects.find((r) => r.id === selected);
  if (outlined) {
    ctx.strokeStyle = palette.selectedEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(outlined.x + 1, outlined.y + 1, outlined.w - 2, outlined.h - 2);
  }
}

import { describe, expect, it } from "vitest";
import { PALETTES } from "../../palette";
import type { TreemapRect } from "./bytes";
import { drawTreemap } from "./draw";

/** Just enough of a canvas context for drawTreemap; records the color of every fill. */
function recorder() {
  const fills: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    clearRect: () => undefined,
    strokeRect: () => undefined,
    fillRect(this: { fillStyle: string }) {
      fills.push(this.fillStyle);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

const rects: TreemapRect[] = [
  { x: 0, y: 0, w: 100, h: 100, id: 1, category: 255, depth: 0, isDir: true },
  { x: 10, y: 10, w: 50, h: 50, id: 2, category: 0, depth: 1, isDir: false },
];

describe("drawTreemap", () => {
  it("paints with the palette of the current theme", () => {
    for (const theme of ["dark", "light"] as const) {
      const { ctx, fills } = recorder();
      const palette = PALETTES[theme];
      drawTreemap(ctx, 100, 100, rects, { highlight: null, selected: null, palette });
      expect(fills).toEqual([palette.dirFill, palette.categories[0]]);
    }
  });
});

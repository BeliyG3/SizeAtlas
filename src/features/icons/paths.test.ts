import { describe, expect, it } from "vitest";
import { CATEGORY_NAMES } from "../../palette";
import { CATEGORY_ICONS, ICONS } from "./paths";

/** Number of arguments of each path command. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, a: 7, z: 0 };

/** The end points of the segments of `d` (control-free commands only), in absolute coordinates. */
function points(d: string): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  let start: [number, number] = [0, 0];
  for (const [, cmd, rest] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const args = (rest.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    const n = ARITY[lower];
    expect(n, `command ${cmd}`).toBeDefined();
    if (n === 0) [x, y] = start;
    for (let i = 0; n > 0 && i < args.length; i += n) {
      const a = args.slice(i, i + n);
      if (lower === "h") x = (rel ? x : 0) + a[0];
      else if (lower === "v") y = (rel ? y : 0) + a[0];
      else {
        const [px, py] = a.slice(-2);
        x = (rel ? x : 0) + px;
        y = (rel ? y : 0) + py;
      }
      if (lower === "m" && i === 0) start = [x, y];
      out.push([x, y]);
    }
  }
  return out;
}

describe("icons", () => {
  it("has an icon for every file category", () => {
    expect(CATEGORY_ICONS).toHaveLength(CATEGORY_NAMES.length);
  });

  it("keeps every icon inside the grid, clear of the edge for the stroke", () => {
    for (const [name, d] of Object.entries(ICONS)) {
      for (const [x, y] of points(d)) {
        expect(Math.min(x, y), name).toBeGreaterThanOrEqual(1);
        expect(Math.max(x, y), name).toBeLessThanOrEqual(15);
      }
    }
  });
});

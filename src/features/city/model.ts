/** The scene model of the city: plates and buildings from the layout; pure, no three.js. */
import type { CityData, CityRect } from "./bytes";
import type { Box } from "./frame";

/** Side of the layout field; must match `CITY_FIELD` in core/src/treemap/city.rs. */
export const FIELD = 1000;
/** The field maps onto a WORLD × WORLD ground, so 10 layout pixels make 1 unit. */
export const WORLD = 100;
/** Thickness of a folder plate, one step per depth. */
export const PLATE = 0.2;
export const MAX_HEIGHT = 30;
export const MIN_HEIGHT = 0.3;
/** Fraction of a building's smaller side trimmed off so neighbours separate... */
export const GAP = 0.15;
/** ...but never more than this, in units. */
const MAX_GAP = 0.3;
/** Each plate edge moves in by at most this, below the 0.1-unit padding children sit in. */
const PLATE_TRIM = 0.04;
/** Layout pixels of slack in the containment test. */
const EPS = 0.01;

/**
 * `plate`: an expanded folder, its children stand on it. `building`: a file.
 * `dirBuilding`: a folder whose inside was not laid out, drawn solid with its height from size.
 */
export type BlockKind = "plate" | "building" | "dirBuilding";

/**
 * One box of the scene, in world units: centre `x, z` on the ground, footprint `w × d`,
 * `y` its bottom (not its centre) and `h` its height, so it spans `y … y + h`.
 * The view shades plates by `depth` (alternate tones for odd and even) and colours
 * buildings by `category`; folders have category 255.
 */
export interface Block {
  id: number;
  kind: BlockKind;
  isDir: boolean;
  category: number;
  depth: number;
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
  h: number;
  /** Lies outside the focus and is not one of its ancestors. */
  dim: boolean;
}

export interface City {
  blocks: Block[];
  /** The focus block up to the top of what stands on it; null without a focus. */
  focusBox: Box | null;
  /** The whole ground up to the tallest top. */
  bounds: Box;
}

/** Height of a building of `size` when the biggest one has `max`: grows with √size. */
export function buildingHeight(size: number, max: number): number {
  if (!(max > 0)) return MIN_HEIGHT;
  const t = Math.min(1, Math.max(0, size / max));
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.sqrt(t);
}

function inside(a: CityRect, b: CityRect): boolean {
  return (
    a.x >= b.x - EPS &&
    a.y >= b.y - EPS &&
    a.x + a.w <= b.x + b.w + EPS &&
    a.y + a.h <= b.y + b.h + EPS
  );
}

const kindOf = (r: CityRect): BlockKind =>
  !r.isDir ? "building" : r.expanded ? "plate" : "dirBuilding";

/**
 * Turns the layout into blocks. `focus` is the id of the laid-out folder to highlight
 * (see `focusIn`); null or an id not in the layout dims nothing. The treemap nests children
 * inside their parents, so what lies inside the focus rect is its subtree and what contains
 * it are its ancestors.
 */
export function buildCity(data: CityData, focus: number | null): City {
  const scale = WORLD / FIELD;
  let max = 0;
  for (const r of data.rects) if (kindOf(r) !== "plate") max = Math.max(max, r.size);
  const f = focus === null ? undefined : data.rects.find((r) => r.id === focus);
  const blocks: Block[] = [];
  let top = 0;
  let focusTop = 0;
  let focusBlock: Block | undefined;
  for (const r of data.rects) {
    const kind = kindOf(r);
    let w = r.w * scale;
    let d = r.h * scale;
    if (kind === "plate") {
      w -= 2 * Math.min(PLATE_TRIM, w * 0.05);
      d -= 2 * Math.min(PLATE_TRIM, d * 0.05);
    } else {
      const trim = Math.min(MAX_GAP, GAP * Math.min(w, d));
      w -= trim;
      d -= trim;
    }
    const block: Block = {
      id: r.id,
      kind,
      isDir: r.isDir,
      category: r.category,
      depth: r.depth,
      x: (r.x + r.w / 2) * scale,
      z: (r.y + r.h / 2) * scale,
      w,
      d,
      // Depth-0 blocks stand on the ground, deeper ones on their parent plate's top.
      y: r.depth * PLATE,
      h: kind === "plate" ? PLATE : buildingHeight(r.size, max),
      dim: f !== undefined && !inside(r, f) && !inside(f, r),
    };
    blocks.push(block);
    top = Math.max(top, block.y + block.h);
    if (f && inside(r, f)) focusTop = Math.max(focusTop, block.y + block.h);
    if (r === f) focusBlock = block;
  }
  const focusBox: Box | null = focusBlock
    ? {
        min: [focusBlock.x - focusBlock.w / 2, focusBlock.y, focusBlock.z - focusBlock.d / 2],
        max: [focusBlock.x + focusBlock.w / 2, focusTop, focusBlock.z + focusBlock.d / 2],
      }
    : null;
  const bounds: Box = { min: [0, 0, 0], max: [WORLD, top, WORLD] };
  return { blocks, focusBox, bounds };
}

/**
 * The block to highlight for a selection. `path` holds the ids from the root down to the
 * selected node (`api.getCrumbs`); the answer is its deepest laid-out folder, so a file
 * gives its folder and a folder too small for the layout its nearest laid-out ancestor.
 * Null (the whole city lit) when that is the root.
 */
export function focusIn(data: CityData, path: readonly number[]): number | null {
  const dirs = new Set(data.rects.filter((r) => r.isDir).map((r) => r.id));
  for (let i = path.length - 1; i >= 0; i--) if (dirs.has(path[i])) return path[i];
  return null;
}

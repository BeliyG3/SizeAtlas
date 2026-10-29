/**
 * What the game's bodies stand on and run into, asked point by point: the roofs, the bridge
 * decks, the ground and the water; pure, no three.js. Shapes are binned on a grid of `CELL`
 * metres, so a query looks at a few of them, and it allocates nothing.
 */
import type { World } from "../world/buildings";
import { POLY } from "../world/map";
import { roadHalf, type RoadGraph } from "../world/roads";
import { CELL, binBoxes, cellAt, insidePoly, polyBoxes, type Bins } from "./bins";

/**
 * A deck rises from the ground over this many metres where it meets a road on the ground (the
 * map's decks are flat; walking and driving onto them need a ramp).
 */
export const DECK_RAMP = 8;

export interface Solids {
  /**
   * The surface under a body whose top is at `top` (any height by default): a roof, a bridge
   * deck not over `top` (a higher one passes overhead), else the ground, 0.
   */
  heightAt(x: number, z: number, top?: number): number;
  /** Neither land nor a bridge deck: the sea or the canal. */
  isWater(x: number, z: number): boolean;
  /** The roof of the house standing at (x, z), null if none does. */
  roofAt(x: number, z: number): number | null;
  /** The height of the tallest house, metres. */
  tallest: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

interface Layer {
  polys: Float32Array[];
  boxes: Float64Array;
  bins: Bins;
}

function layer(polys: Float32Array[], nx: number, nz: number): Layer {
  const boxes = polyBoxes(polys);
  return { polys, boxes, bins: binBoxes(boxes, nx, nz) };
}

/** The index of a polygon of `l` covering (x, z) after `from` in the cell's list, or -1. */
function hit(l: Layer, cell: number, x: number, z: number, from: number): number {
  const { start, items } = l.bins;
  for (let k = from; k < start[cell + 1]; k++) {
    const i = items[k];
    const b = i * 4;
    const inBox =
      x >= l.boxes[b] && x <= l.boxes[b + 2] && z >= l.boxes[b + 1] && z <= l.boxes[b + 3];
    if (inBox && insidePoly(l.polys[i], x, z)) return k;
  }
  return -1;
}

function covers(l: Layer, x: number, z: number): boolean {
  const cell = cellAt(l.bins, x, z);
  return cell >= 0 && hit(l, cell, x, z, l.bins.start[cell]) >= 0;
}

/** Floats per deck: x0, z0, ux, uz, len, half, liftA, liftB, rampA, rampB (1: rises from the ground). */
const DECK = 10;

function smoothstep(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

export function createSolids(world: World, g: RoadGraph): Solids {
  const { map, buildings } = world;
  const nx = Math.max(1, Math.ceil(map.width / CELL));
  const nz = Math.max(1, Math.ceil(map.height / CELL));
  const houses = layer(
    buildings.map((b) => b.points),
    nx,
    nz,
  );
  const roofs = Float64Array.from(buildings, (b) => b.h);
  const ofKind = (kind: number) =>
    layer(
      map.polys.filter((p) => p.kind === kind).map((p) => p.points),
      nx,
      nz,
    );
  const land = ofKind(POLY.island);
  const canal = ofKind(POLY.water);

  // A deck meets the ground at a node that a road on the ground also reaches.
  const grounded = new Uint8Array(g.nodes.length / 2);
  for (const e of g.edges) if (!e.bridge) grounded[e.a] = grounded[e.b] = 1;
  const bridges = g.edges.filter((e) => e.bridge && e.len > 0);
  const deck = new Float64Array(bridges.length * DECK);
  const deckBoxes = new Float64Array(bridges.length * 4);
  bridges.forEach((e, i) => {
    const [x0, z0] = [g.nodes[e.a * 2], g.nodes[e.a * 2 + 1]];
    const [ux, uz] = [(g.nodes[e.b * 2] - x0) / e.len, (g.nodes[e.b * 2 + 1] - z0) / e.len];
    const half = roadHalf(e.cls);
    deck.set(
      [x0, z0, ux, uz, e.len, half, e.liftA, e.liftB, grounded[e.a], grounded[e.b]],
      i * DECK,
    );
    // The deck reaches `half` past its nodes, as the road ribbons do.
    const corners = [-half, e.len + half].flatMap((s) =>
      [-half, half].map((t) => [x0 + ux * s - uz * t, z0 + uz * s + ux * t]),
    );
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    deckBoxes.set([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], i * 4);
  });
  const deckBins = binBoxes(deckBoxes, nx, nz);

  /** The deck's height at (x, z), -Infinity off it. */
  const deckAt = (i: number, x: number, z: number): number => {
    const o = i * DECK;
    const dx = x - deck[o];
    const dz = z - deck[o + 1];
    const ux = deck[o + 2];
    const uz = deck[o + 3];
    const len = deck[o + 4];
    const half = deck[o + 5];
    const t = dx * ux + dz * uz;
    if (t < -half || t > len + half || Math.abs(dx * uz - dz * ux) > half) return -Infinity;
    const s = Math.min(len, Math.max(0, t));
    const lift = deck[o + 6] + ((deck[o + 7] - deck[o + 6]) * s) / len;
    const fromGround = Math.min(deck[o + 8] ? s : Infinity, deck[o + 9] ? len - s : Infinity);
    return lift * smoothstep(fromGround / DECK_RAMP);
  };
  /** The highest deck at (x, z) not over `top`, -Infinity for none; `top` Infinity: any deck. */
  const deckUnder = (x: number, z: number, top: number): number => {
    const cell = cellAt(deckBins, x, z);
    let best = -Infinity;
    if (cell < 0) return best;
    for (let k = deckBins.start[cell]; k < deckBins.start[cell + 1]; k++) {
      const h = deckAt(deckBins.items[k], x, z);
      if (h <= top && h > best) best = h;
    }
    return best;
  };
  const roofTop = (x: number, z: number): number => {
    const cell = cellAt(houses.bins, x, z);
    let best = -Infinity;
    if (cell < 0) return best;
    for (
      let k = hit(houses, cell, x, z, houses.bins.start[cell]);
      k >= 0;
      k = hit(houses, cell, x, z, k + 1)
    ) {
      best = Math.max(best, roofs[houses.bins.items[k]]);
    }
    return best;
  };

  return {
    heightAt: (x, z, top = Infinity) => Math.max(0, roofTop(x, z), deckUnder(x, z, top)),
    isWater: (x, z) =>
      deckUnder(x, z, Infinity) === -Infinity && (covers(canal, x, z) || !covers(land, x, z)),
    roofAt: (x, z) => {
      const h = roofTop(x, z);
      return h === -Infinity ? null : h;
    },
    tallest: buildings.reduce((m, b) => Math.max(m, b.h), 0),
    bounds: { minX: 0, minZ: 0, maxX: map.width, maxZ: map.height },
  };
}

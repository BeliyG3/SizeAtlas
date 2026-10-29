/**
 * The bridge decks as the physics stands on them: the road's own height along each bridge edge
 * (`pointOn`, as the traffic and the renderer lift it); pure, no three.js, no allocation in a
 * query.
 *
 * A deck reaches half its width past its nodes, as the road ribbons do. Where it meets a road on
 * the ground, that end piece slopes from the ground up to the deck instead of standing as a step
 * of `BRIDGE_RISE` (the drawn decks start with one; a body could not get onto them).
 */
import { pointOn, roadHalf, type RoadGraph, type RoadPoint } from "../world/roads";
import { binBoxes, cellAt } from "./bins";

/** Floats per deck: x0, z0, ux, uz, len, half, edge, groundedA, groundedB. */
const DECK = 9;

/** The highest deck at (x, z) not over `top`, -Infinity for none. */
export type DeckUnder = (x: number, z: number, top: number) => number;

export function createDecks(g: RoadGraph, nx: number, nz: number): DeckUnder {
  // A deck meets the ground at a node that a road on the ground also reaches.
  const grounded = new Uint8Array(g.nodes.length / 2);
  for (const e of g.edges) if (!e.bridge) grounded[e.a] = grounded[e.b] = 1;
  const bridges = g.edges.flatMap((e, i) => (e.bridge && e.len > 0 ? [i] : []));
  const deck = new Float64Array(bridges.length * DECK);
  const boxes = new Float64Array(bridges.length * 4);
  bridges.forEach((edge, i) => {
    const e = g.edges[edge];
    const [x0, z0] = [g.nodes[e.a * 2], g.nodes[e.a * 2 + 1]];
    const [ux, uz] = [(g.nodes[e.b * 2] - x0) / e.len, (g.nodes[e.b * 2 + 1] - z0) / e.len];
    const half = roadHalf(e.cls);
    deck.set([x0, z0, ux, uz, e.len, half, edge, grounded[e.a], grounded[e.b]], i * DECK);
    const corners = [-half, e.len + half].flatMap((s) =>
      [-half, half].map((t) => [x0 + ux * s - uz * t, z0 + uz * s + ux * t]),
    );
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    boxes.set([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], i * 4);
  });
  const bins = binBoxes(boxes, nx, nz);
  const at: RoadPoint = { x: 0, y: 0, z: 0, heading: 0 };

  // Set by `height`: the point lies on the deck's end piece, past its nodes.
  let past = false;
  /** Deck `i`'s height at (x, z), -Infinity off it. */
  const height = (i: number, x: number, z: number): number => {
    const o = i * DECK;
    const dx = x - deck[o];
    const dz = z - deck[o + 1];
    const ux = deck[o + 2];
    const uz = deck[o + 3];
    const len = deck[o + 4];
    const half = deck[o + 5];
    const t = dx * ux + dz * uz;
    if (t < -half || t > len + half || Math.abs(dx * uz - dz * ux) > half) return -Infinity;
    past = t < 0 || t > len;
    const y = pointOn(g, deck[o + 6], Math.min(len, Math.max(0, t)), true, 0, at).y;
    if (t < 0 && deck[o + 7]) return y * (1 + t / half);
    if (t > len && deck[o + 8]) return y * (1 - (t - len) / half);
    return y;
  };

  // An end piece only fills what no deck covers between its nodes: the outside of a bend, a
  // ramp from the ground. Where a ramp meets a flat run, the run's end must not stand over it.
  return (x, z, top) => {
    const cell = cellAt(bins, x, z);
    let on = -Infinity;
    let end = -Infinity;
    if (cell < 0) return on;
    for (let k = bins.start[cell]; k < bins.start[cell + 1]; k++) {
      const h = height(bins.items[k], x, z);
      if (h > top) continue;
      if (past) end = Math.max(end, h);
      else on = Math.max(on, h);
    }
    return on > -Infinity ? on : end;
  };
}

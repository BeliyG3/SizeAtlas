/** Helpers of the tests of the bridges' chains and ramps. */
import type { ArchipelagoBridge } from "../../../api/types";
import { bridgeChains, deckLift } from "./bridgeChains";

export type Pt = [number, number];

/** A bridge over `points`; `levels` is one level for every run, or one per run. */
export const bridge = (points: Pt[], levels: number | number[] = 0): ArchipelagoBridge => ({
  a: [0, 0],
  b: [0, 0],
  points,
  levels: typeof levels === "number" ? points.slice(1).map(() => levels) : levels,
});

// The gates are nodes of the merged map before 100; the new nodes are numbered from there.
export const FIRST = 100;
export const D0 = deckLift(0);
export const D1 = deckLift(1);
export const key = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;

/** The chains of `bridges` (gate nodes `ends`), with lookups by the coordinates of the nodes. */
export function chains(bridges: ArchipelagoBridge[], ends: [number, number][], dx = 0, dz = 0) {
  const out = bridgeChains(bridges, ends, FIRST, dx, dz);
  const at = new Map<number, Pt>();
  bridges.forEach((b, i) => {
    at.set(ends[i][0], b.points[0]);
    at.set(ends[i][1], b.points[b.points.length - 1]);
  });
  for (let i = 0; i < out.nodes.length; i += 2) {
    at.set(FIRST + i / 2, [out.nodes[i], out.nodes[i + 1]]);
  }
  const touching = (p: Pt) =>
    out.edges.filter((e) => key(at.get(e.a)!) === key(p) || key(at.get(e.b)!) === key(p));
  return {
    ...out,
    /** The new nodes as coordinates. */
    spots: Array.from({ length: out.nodes.length / 2 }, (_, i): Pt => [
      out.nodes[i * 2],
      out.nodes[i * 2 + 1],
    ]),
    /** How many edges meet at `p`. */
    degree: (p: Pt) => touching(p).length,
    /** `[lift at p, lift at q]` of each edge between the two points. */
    lifts: (p: Pt, q: Pt) =>
      touching(p)
        .filter((e) => key(at.get(e.a)!) === key(q) || key(at.get(e.b)!) === key(q))
        .map((e) => (key(at.get(e.a)!) === key(p) ? [e.liftA, e.liftB] : [e.liftB, e.liftA])),
    /** The edges that join the same two nodes as another edge (there must be none). */
    doubled: () => {
      const seen = new Set<string>();
      return out.edges.filter((e) => {
        const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
        return seen.size === seen.add(k).size;
      });
    },
  };
}

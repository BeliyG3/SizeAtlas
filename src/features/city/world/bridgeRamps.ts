/**
 * The heights of the bridges' roads over the sea; pure, no three.js. A run stands on its own
 * deck; where it meets a lower one it comes down to it over a short ramp, so a run keeps its
 * height (and the clearance over the bridges it crosses) except for the last `RAMP` metres.
 */
import { BRIDGE_RISE, ROAD, type MapEdge } from "./map";

/** A ramp between two decks is this long at most, metres (half the run if that is shorter). */
export const RAMP = 40;

/** One road between two nodes of the bridges' graph, standing on `deck` metres. */
export interface Run {
  a: number;
  b: number;
  deck: number;
}

/**
 * The edges of `runs` with their heights. A node stands as high as the lowest deck of the runs
 * that meet there; a gate node (`isGate`) at `BRIDGE_RISE`, where the first or last run of a
 * bridge climbs all the way to its deck. A run higher than a node it ends at has a ramp node
 * `RAMP` metres short of it (in the middle, if the run is too short for two ramps), made by
 * `addNode(x, z)`. `at(node)` is a node's position.
 */
export function rampedEdges(
  runs: Run[],
  at: (node: number) => [number, number],
  isGate: (node: number) => boolean,
  addNode: (x: number, z: number) => number,
): MapEdge[] {
  const low = new Map<number, number>();
  for (const { a, b, deck } of runs) {
    for (const n of [a, b]) low.set(n, Math.min(low.get(n) ?? Infinity, deck));
  }
  const height = (n: number) => (isGate(n) ? BRIDGE_RISE : low.get(n)!);
  const edges: MapEdge[] = [];
  const edge = (a: number, b: number, liftA: number, liftB: number) =>
    edges.push({ a, b, cls: ROAD.highway, bridge: true, liftA, liftB });
  for (const { a, b, deck } of runs) {
    const [p, q] = [at(a), at(b)];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const upA = !isGate(a) && height(a) < deck;
    const upB = !isGate(b) && height(b) < deck;
    const r = Math.min(RAMP, len / 2);
    // Where along the run the deck is reached or left.
    const stops =
      upA && upB && len <= 2 * RAMP ? [len / 2] : [...(upA ? [r] : []), ...(upB ? [len - r] : [])];
    let [from, lift] = [a, height(a)];
    for (const s of stops) {
      const node = addNode(p[0] + ((q[0] - p[0]) * s) / len, p[1] + ((q[1] - p[1]) * s) / len);
      edge(from, node, lift, deck);
      [from, lift] = [node, deck];
    }
    edge(from, b, lift, height(b));
  }
  return edges;
}

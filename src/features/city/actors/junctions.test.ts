import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads, type RoadGraph } from "../world/roads";
import { createJunctions, laneOffset, lanes, MIN_GAP } from "./junctions";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

/** A ground car as the junctions see it: where it is and, once chosen, where it goes. */
interface Car {
  edge: number;
  s: number;
  forward?: boolean;
  lane?: number;
  next?: [edge: number, forward: boolean, lane: number];
  since?: number;
}

/** The junctions over `cars` on `g`, their turns taken. */
function junctionsOf(g: RoadGraph, cars: Car[]) {
  const n = cars.length;
  const s = {
    g,
    t: {
      edge: Int32Array.from(cars, (c) => c.edge),
      s: Float32Array.from(cars, (c) => c.s),
      forward: Uint8Array.from(cars, (c) => (c.forward === false ? 0 : 1)),
    },
    lane: Uint8Array.from(cars, (c) => c.lane ?? 0),
    nextE: Int32Array.from(cars, (c) => c.next?.[0] ?? -1),
    nextF: Uint8Array.from(cars, (c) => (c.next?.[1] === false ? 0 : 1)),
    nextL: Uint8Array.from(cars, (c) => c.next?.[2] ?? 0),
    since: Float64Array.from(cars, (c) => c.since ?? 0),
    turn: new Float64Array(n),
    live: new Uint8Array(n).fill(1),
    ground: n,
  };
  const j = createJunctions(s);
  j.takeTurns();
  return { ...j, turn: s.turn };
}

// A crossroads at node 0 (0, 0): edge 0 comes from the west, 1 from the south, 2 leaves east,
// 3 leaves north; streets of 100 m.
const cross = graphOf(
  [0, 0, -100, 0, 0, -100, 100, 0, 0, 100],
  [
    [1, 0, ROAD.street],
    [2, 0, ROAD.street],
    [0, 3, ROAD.street],
    [0, 4, ROAD.street],
  ],
);

describe("lanes and offsets", () => {
  it("counts lanes per direction and puts them right of the axis", () => {
    expect([ROAD.highway, ROAD.ring, ROAD.ramp, ROAD.street, ROAD.lane].map(lanes)).toEqual([
      2, 2, 2, 1, 0,
    ]);
    expect([laneOffset(ROAD.highway, 0), laneOffset(ROAD.highway, 1)]).toEqual([2, 6]);
    expect(laneOffset(ROAD.street, 0)).toBe(1.5);
  });
});

describe("createJunctions", () => {
  it("measures the gap to the car in front on the lane", () => {
    const j = junctionsOf(cross, [
      { edge: 0, s: 10 },
      { edge: 0, s: 25 },
      { edge: 0, s: 40, lane: 1 },
    ]);
    expect(j.gapAhead(0)).toBe(15);
    expect(j.gapAhead(1)).toBe(Infinity);
    expect(j.crowded(0, 1, 0, 30, -1)).toBe(true);
    expect(j.crowded(0, 1, 0, 30 + MIN_GAP, -1)).toBe(false);
  });

  it("lets the car that chose its way first go first at the node", () => {
    // Both head east out of the node: the one from the south chose first, though it is farther.
    const j = junctionsOf(cross, [
      { edge: 0, s: 95, next: [2, true, 0], since: 2 },
      { edge: 1, s: 80, next: [2, true, 0], since: 1 },
    ]);
    expect(j.gapAhead(0)).toBe(5 - 20); // it waits until the other is through
    expect(j.gapAhead(1)).toBe(Infinity);
  });

  it("holds no one up for a car that still has to change lanes", () => {
    // The end of a highway, every way out a street: one lane. Car 0 stands at the node in lane 1
    // and has the first turn; car 2 beside it in lane 0 keeps it from moving over. Car 1, coming
    // from the south the way car 0 goes, waiting for car 0 closed a ring: 2 waits for 1 (its lane
    // out runs on from car 2's), 1 for 0, 0 for 2.
    const end = graphOf(
      [0, 0, -100, 0, 0, -100, 100, 0, 0, 100],
      [
        [1, 0, ROAD.highway],
        [2, 0, ROAD.street],
        [0, 3, ROAD.street],
        [0, 4, ROAD.street],
      ],
    );
    const j = junctionsOf(end, [
      { edge: 0, s: 100, lane: 1, next: [2, true, 0], since: 1 },
      { edge: 1, s: 92, next: [2, true, 0], since: 2 },
      { edge: 0, s: 100, lane: 0, next: [3, true, 0], since: 3 },
    ]);
    expect(j.crowded(0, 1, 0, 100, 0)).toBe(true); // car 0 cannot move over
    expect(j.gapAhead(2)).toBeLessThan(MIN_GAP); // car 2 waits for car 1
    expect(j.gapAhead(1)).toBe(Infinity); // but car 1 does not wait for car 0
  });

  it("lets a car that changed lanes not cut in on one close to the node", () => {
    const cars = (s: number) =>
      junctionsOf(cross, [
        { edge: 0, s: 100, next: [2, true, 0], since: 1 },
        { edge: 1, s, next: [2, true, 0], since: 2 },
      ]);
    expect(cars(95).cutsIn(0)).toBe(true);
    expect(cars(80).cutsIn(0)).toBe(false);
  });

  it("gives a car the turn of the earliest car queued behind it", () => {
    const j = junctionsOf(cross, [
      { edge: 0, s: 90, next: [2, true, 0], since: 5 },
      { edge: 0, s: 80, next: [2, true, 0], since: 1 },
      { edge: 1, s: 95, next: [2, true, 0], since: 3 },
    ]);
    expect(Array.from(j.turn)).toEqual([1, 1, 3]);
    // So the car in front does not wait for the one its follower would let through.
    expect(j.gapAhead(0)).toBe(Infinity);
    expect(j.gapAhead(2)).toBeLessThan(0);
  });
});

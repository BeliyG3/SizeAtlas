import { describe, expect, it } from "vitest";
import { BRIDGE_RISE } from "./map";
import { RAMP } from "./bridgeRamps";
import { deckLift } from "./bridgeChains";
import { D0, D1, bridge, chains, key } from "./bridgeChains.fixture";

describe("deckLift", () => {
  it("is 8 m on the first level and 5 m higher on each next", () => {
    expect(deckLift(0)).toBe(8);
    expect(deckLift(2)).toBe(18);
  });
});

describe("bridgeChains", () => {
  it("shifts the points by (dx, dz)", () => {
    const c = chains(
      [
        bridge([
          [0, 0],
          [10, 0],
          [10, 9],
          [0, 9],
        ]),
      ],
      [[1, 3]],
      5,
      -2,
    );
    expect(c.spots).toEqual([
      [15, -2],
      [15, 7],
    ]);
  });

  it("makes bridges that leave a gate along the same points one run up to the fork", () => {
    // They share the run to (300, 0) on level 0; then one goes on east, the other south on level 1.
    const c = chains(
      [
        bridge(
          [
            [50, 0],
            [300, 0],
            [1000, 0],
            [1050, 0],
          ],
          0,
        ),
        bridge(
          [
            [50, 0],
            [300, 0],
            [300, 1000],
            [50, 1000],
          ],
          [0, 1, 1],
        ),
      ],
      [
        [1, 3],
        [1, 5],
      ],
    );
    expect(c.doubled()).toEqual([]);
    expect(c.degree([50, 0])).toBe(1);
    expect(c.degree([300, 0])).toBe(3);
    expect(c.lifts([50, 0], [300, 0])).toEqual([[BRIDGE_RISE, D0]]);
    expect(c.lifts([300, 0], [1000, 0])).toEqual([[D0, D0]]);
    // The higher branch rises on its first RAMP metres, then stays level, then falls to its gate.
    expect(c.lifts([300, 0], [300, RAMP])).toEqual([[D0, D1]]);
    expect(c.lifts([300, RAMP], [300, 1000])).toEqual([[D1, D1]]);
    expect(c.lifts([300, 1000], [50, 1000])).toEqual([[D1, BRIDGE_RISE]]);
  });

  it("makes bridges that arrive at a gate along the same points one run too", () => {
    const c = chains(
      [
        bridge(
          [
            [1050, 0],
            [900, 0],
            [300, 0],
            [50, 0],
          ],
          0,
        ),
        bridge(
          [
            [50, 1000],
            [300, 1000],
            [300, 0],
            [50, 0],
          ],
          [1, 1, 0],
        ),
      ],
      [
        [3, 1],
        [5, 1],
      ],
    );
    expect(c.doubled()).toEqual([]);
    expect(c.degree([50, 0])).toBe(1);
    expect(c.degree([300, 0])).toBe(3);
    expect(c.lifts([300, 0], [50, 0])).toEqual([[D0, BRIDGE_RISE]]);
    expect(c.lifts([300, 0], [300, RAMP])).toEqual([[D0, D1]]);
    expect(c.lifts([300, 1000], [300, RAMP])).toEqual([[D1, D1]]);
  });

  // Two bridges leave the gate (0, 0) east; the first runs end at 40 m and at 70 m.
  it.each([
    ["the shared run on level 0", [0, 0, 0], [0, 1, 1], D0],
    ["the shared run on level 1", [1, 0, 0], [1, 1, 1], D1],
  ])("splits the longer first run where the shorter ends: %s", (_, long, short, deck) => {
    const c = chains(
      [
        bridge(
          [
            [0, 0],
            [70, 0],
            [70, 300],
            [500, 300],
          ],
          long,
        ),
        bridge(
          [
            [0, 0],
            [40, 0],
            [40, -200],
            [500, -200],
          ],
          short,
        ),
      ],
      [
        [1, 3],
        [1, 5],
      ],
    );
    expect(c.doubled()).toEqual([]);
    // (40, 0) is one node on both; one edge, 0-40 m, leaves the gate and ramps to the deck.
    expect(c.spots.filter((p) => key(p) === key([40, 0]))).toHaveLength(1);
    expect(c.degree([0, 0])).toBe(1);
    expect(c.lifts([0, 0], [40, 0])).toEqual([[BRIDGE_RISE, deck]]);
    // The longer bridge goes on from there to (70, 0), the shorter turns south at it.
    expect(c.degree([40, 0])).toBe(3);
  });

  it("splits the longer last run too, and joins a bridge that arrives to one that leaves", () => {
    const c = chains(
      [
        // Leaves the gate east for 70 m ...
        bridge(
          [
            [0, 0],
            [70, 0],
            [70, 300],
            [500, 300],
          ],
          0,
        ),
        // ... and one arrives from the south and then from the east, its last run 40 m.
        bridge(
          [
            [500, -200],
            [40, -200],
            [40, 0],
            [0, 0],
          ],
          [1, 1, 0],
        ),
      ],
      [
        [1, 3],
        [5, 1],
      ],
    );
    expect(c.doubled()).toEqual([]);
    expect(c.degree([0, 0])).toBe(1);
    expect(c.lifts([0, 0], [40, 0])).toEqual([[BRIDGE_RISE, D0]]);
    expect(c.lifts([40, 0], [70, 0])).toEqual([[D0, D0]]);
    expect(c.lifts([40, 0], [40, -RAMP])).toEqual([[D0, D1]]);
  });

  it("keeps apart the runs that only run alongside", () => {
    const c = chains(
      [
        bridge([
          [0, 0],
          [70, 0],
          [70, 300],
          [500, 300],
        ]),
        bridge([
          [0, 0],
          [40, 1],
          [40, -200],
          [500, -200],
        ]),
      ],
      [
        [1, 3],
        [1, 5],
      ],
    );
    expect(c.spots).toHaveLength(4);
  });

  it("draws a trunk that two bridges from different gates share once", () => {
    // Both cross the sea along (300, 250) - (700, 250), from the west and to the east.
    const c = chains(
      [
        bridge([
          [0, 0],
          [300, 250],
          [700, 250],
          [1000, 0],
        ]),
        bridge([
          [0, 500],
          [300, 250],
          [700, 250],
          [1000, 500],
        ]),
      ],
      [
        [1, 5],
        [3, 7],
      ],
    );
    expect(c.spots).toEqual([
      [300, 250],
      [700, 250],
    ]);
    expect(c.edges).toHaveLength(5);
    expect(c.doubled()).toEqual([]);
    // The forks, and the trunk between them on one deck.
    expect(c.degree([300, 250])).toBe(3);
    expect(c.degree([700, 250])).toBe(3);
    expect(c.lifts([300, 250], [700, 250])).toEqual([[D0, D0]]);
  });

  it("splits a run where a vertex of another bridge lies on it", () => {
    // The second bridge's corner (400, 0) is inside the first one's first run (0, 0) - (1000, 0).
    const c = chains(
      [
        bridge([
          [0, 0],
          [1000, 0],
          [1000, 500],
        ]),
        bridge([
          [400, 300],
          [400, 0],
          [400, -300],
        ]),
      ],
      [
        [1, 5],
        [3, 7],
      ],
    );
    expect(c.doubled()).toEqual([]);
    expect(c.spots.filter((p) => key(p) === key([400, 0]))).toHaveLength(1);
    expect(c.degree([400, 0])).toBe(4);
    expect(c.edges).toHaveLength(5);
  });
});

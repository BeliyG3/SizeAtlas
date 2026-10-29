import { describe, expect, it } from "vitest";
import { BRIDGE_RISE } from "./map";
import { RAMP } from "./bridgeRamps";
import { D0, D1, bridge, chains } from "./bridgeChains.fixture";

describe("ramps of the bridges", () => {
  it("rises on the first straight, stays level, falls on the last", () => {
    const c = chains(
      [
        bridge([
          [50, 0],
          [300, 0],
          [800, 0],
          [1050, 0],
        ]),
      ],
      [[1, 3]],
    );
    expect(c.spots).toEqual([
      [300, 0],
      [800, 0],
    ]);
    expect(c.edges.map((e) => [e.a, e.b, e.liftA, e.liftB])).toEqual([
      [1, 100, BRIDGE_RISE, D0],
      [100, 101, D0, D0],
      [101, 3, D0, BRIDGE_RISE],
    ]);
  });

  it("gives a bridge of one straight run a node in its middle to rise to and fall from", () => {
    const c = chains(
      [
        bridge(
          [
            [50, 0],
            [1050, 0],
          ],
          1,
        ),
      ],
      [[1, 3]],
    );
    expect(c.spots).toEqual([[550, 0]]);
    expect(c.edges.map((e) => [e.liftA, e.liftB])).toEqual([
      [BRIDGE_RISE, D1],
      [D1, BRIDGE_RISE],
    ]);
  });

  it("lets a trunk on a higher level than its branches rise and fall at the forks", () => {
    const c = chains(
      [
        bridge(
          [
            [0, 0],
            [300, 250],
            [700, 250],
            [1000, 0],
          ],
          [0, 1, 0],
        ),
        bridge(
          [
            [0, 500],
            [300, 250],
            [700, 250],
            [1000, 500],
          ],
          [0, 1, 0],
        ),
      ],
      [
        [1, 5],
        [3, 7],
      ],
    );
    expect(c.doubled()).toEqual([]);
    expect(c.degree([300, 250])).toBe(3);
    expect(c.lifts([300, 250], [300 + RAMP, 250])).toEqual([[D0, D1]]);
    expect(c.lifts([300 + RAMP, 250], [700 - RAMP, 250])).toEqual([[D1, D1]]);
    expect(c.lifts([700 - RAMP, 250], [700, 250])).toEqual([[D1, D0]]);
    expect(c.lifts([0, 0], [300, 250])).toEqual([[BRIDGE_RISE, D0]]);
  });

  it("raises a short run of level 1 between runs of level 0 on short ramps", () => {
    const c = chains(
      [
        bridge(
          [
            [0, 0],
            [600, 0],
            [800, 0],
            [1400, 0],
          ],
          [0, 1, 0],
        ),
      ],
      [[1, 3]],
    );
    expect(c.lifts([0, 0], [600, 0])).toEqual([[BRIDGE_RISE, D0]]);
    expect(c.lifts([600, 0], [600 + RAMP, 0])).toEqual([[D0, D1]]);
    expect(c.lifts([600 + RAMP, 0], [800 - RAMP, 0])).toEqual([[D1, D1]]);
    expect(c.lifts([800 - RAMP, 0], [800, 0])).toEqual([[D1, D0]]);
    expect(c.lifts([800, 0], [1400, 0])).toEqual([[D0, BRIDGE_RISE]]);
  });

  it("peaks in the middle of a run of level 1 too short for two ramps", () => {
    const c = chains(
      [
        bridge(
          [
            [0, 0],
            [600, 0],
            [660, 0],
            [1400, 0],
          ],
          [0, 1, 0],
        ),
      ],
      [[1, 3]],
    );
    expect(c.lifts([600, 0], [630, 0])).toEqual([[D0, D1]]);
    expect(c.lifts([630, 0], [660, 0])).toEqual([[D1, D0]]);
  });
});

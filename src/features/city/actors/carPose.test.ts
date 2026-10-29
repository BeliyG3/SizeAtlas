import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { createPoses, LANE_SHIFT } from "./carPose";
import { CORNER } from "./corners";
import { laneOffset, MIN_GAP } from "./junctions";
import { createTraffic, SPEED, type Traffic } from "./traffic";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

const DT = 1 / 30;
const snap = (t: Traffic) => ({
  x: Float32Array.from(t.x),
  z: Float32Array.from(t.z),
  h: Float32Array.from(t.heading),
});
const turnOf = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// The tightest curve is a right turn off a street, its ends `CORNER - offset` from the lanes'
// crossing: the most a car on a street turns in a frame.
const rMin = (CORNER - laneOffset(ROAD.street, 0)) / Math.SQRT2;
const MOST_TURN = (SPEED.street * DT) / rMin + 1e-3;

describe("drawn cars", () => {
  it("turn on a curve without a jump", () => {
    // A 400 m square of streets: every node a 90 degree corner, no dead end to turn back at.
    const square = graphOf(
      [0, 0, 400, 0, 400, 400, 0, 400],
      [
        [0, 1, ROAD.street],
        [1, 2, ROAD.street],
        [2, 3, ROAD.street],
        [3, 0, ROAD.street],
      ],
    );
    const t = createTraffic(square, 40, 4);
    t.update(DT); // the cars put down near a node choose their way out: now they are drawn turning
    let was = snap(t);
    let bent = 0;
    for (let n = 0; n < 20 * 30; n++) {
      t.update(DT);
      for (let i = 0; i < t.count; i++) {
        if (t.air[i]) continue;
        expect(Math.hypot(t.x[i] - was.x[i], t.z[i] - was.z[i])).toBeLessThanOrEqual(
          SPEED.street * DT + 0.05,
        );
        expect(turnOf(t.heading[i], was.h[i])).toBeLessThanOrEqual(MOST_TURN);
        if (Math.abs(Math.sin(2 * t.heading[i])) > 0.1) bent++;
      }
      was = snap(t);
    }
    expect(bent).toBeGreaterThan(0);
  });

  it("move across to another lane without a jump", () => {
    // A straight road east: a highway for 1000 m, then a street for 1000 m. Going east off the
    // highway onto the street, the cars of the second lane move to the first.
    const line = graphOf(
      [0, 0, 1000, 0, 2000, 0],
      [
        [0, 1, ROAD.highway],
        [1, 2, ROAD.street],
      ],
    );
    const t = createTraffic(line, 100, 3);
    let was = snap(t);
    let between = 0;
    for (let n = 0; n < 30 * 30; n++) {
      t.update(DT);
      for (let i = 0; i < t.count; i++) {
        if (t.air[i] || Math.min(t.x[i], was.x[i]) < 20 || Math.max(t.x[i], was.x[i]) > 1980) {
          continue; // turning back at a dead end
        }
        expect(Math.abs(t.z[i] - was.z[i])).toBeLessThanOrEqual(LANE_SHIFT * DT + 0.01);
        // Leaning into the move and out of it, no faster than it turns on a curve.
        expect(turnOf(t.heading[i], was.h[i])).toBeLessThanOrEqual(MOST_TURN);
        if (Math.abs(t.z[i]) > 2.1 && Math.abs(t.z[i]) < 5.9) between++;
      }
      was = snap(t);
    }
    expect(between).toBeGreaterThan(0);
  });

  it("swing round without a jump as one waiting at its node takes another way out", () => {
    // A street north to a node, on from it a street east and one north. A car at the node that
    // chose the way east is drawn halfway round the curve there, but a queue stands just past
    // the node: after `STUCK` standing it goes north instead.
    const g = graphOf(
      [0, -300, 0, 0, 300, 0, 0, 300],
      [
        [0, 1, ROAD.street],
        [1, 2, ROAD.street],
        [1, 3, ROAD.street],
      ],
    );
    const queue = Array.from({ length: 15 }, (_, k) => ({
      edge: 1,
      s: 1 + MIN_GAP * k,
      forward: true,
      lane: 0,
      want: 0,
    }));
    const start = [{ edge: 0, s: 300, forward: true, lane: 0, want: 0 }, ...queue];
    let swung = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const t = createTraffic(g, start.length, seed, start); // no highway: none fly
      let was = snap(t);
      let east = false; // drawn turning that way
      for (let n = 0; n < 8 * 30; n++) {
        t.update(DT);
        const moved = Math.hypot(t.x[0] - was.x[0], t.z[0] - was.z[0]);
        east ||= t.heading[0] > 0.5;
        expect(moved, `seed ${seed}`).toBeLessThanOrEqual(SPEED.street * DT + 0.05);
        expect(turnOf(t.heading[0], was.h[0]), `seed ${seed}`).toBeLessThanOrEqual(MOST_TURN);
        was = snap(t);
      }
      if (east && t.z[0] > 20) swung++;
    }
    expect(swung).toBeGreaterThan(0); // some chose the way east first
  });
});

describe("createPoses", () => {
  it("draws a car a hair past its road's end with no way out chosen on its lane, not on a curve", () => {
    const g = graphOf(
      [0, 0, 100, 0, 200, 0],
      [
        [0, 1, ROAD.street],
        [1, 2, ROAD.street],
      ],
    );
    const t = { edge: Int32Array.of(0), s: Float32Array.of(100.001), forward: Uint8Array.of(1) };
    const poses = createPoses(g, t, Uint8Array.of(0), Int32Array.of(-1), Uint8Array.of(0));
    poses.reset(0);
    const out = {
      x: new Float32Array(1),
      y: new Float32Array(1),
      z: new Float32Array(1),
      heading: new Float32Array(1),
    };
    expect(() => poses.put(0, out)).not.toThrow();
    expect(out.x[0]).toBeCloseTo(100, 1);
  });
});

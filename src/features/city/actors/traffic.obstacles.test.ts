import { describe, expect, it } from "vitest";
import { ROAD, type RoadKind } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads } from "../world/roads";
import { MIN_GAP } from "./junctions";
import { CAR_SPACING, createTraffic, type Obstacles, type Traffic } from "./traffic";

function graphOf(nodes: number[], edges: [number, number, RoadKind][]) {
  return buildRoads(
    mapOf([], {
      nodes: new Float32Array(nodes),
      edges: edges.map(([a, b, cls]) => ({ a, b, cls, bridge: false, liftA: 0, liftB: 0 })),
    }),
  );
}

// A 400 m square highway ring with a 300 m street spur off its corner at (400, 0).
const ring = graphOf(
  [0, 0, 400, 0, 400, 400, 0, 400, 400, -300],
  [
    [0, 1, ROAD.highway],
    [1, 2, ROAD.highway],
    [2, 3, ROAD.highway],
    [3, 0, ROAD.highway],
    [1, 4, ROAD.street],
  ],
);

// A straight road east: a highway for 1000 m, then a street for 1000 m.
const line = graphOf(
  [0, 0, 1000, 0, 2000, 0],
  [
    [0, 1, ROAD.highway],
    [1, 2, ROAD.street],
  ],
);

type At = [x: number, y: number, z: number, r: number];

const obstaclesAt = (...at: At[]): Obstacles => ({
  count: at.length,
  x: Float64Array.from(at, (p) => p[0]),
  y: Float64Array.from(at, (p) => p[1]),
  z: Float64Array.from(at, (p) => p[2]),
  r: Float64Array.from(at, (p) => p[3]),
});

/** One car east on the highway's `lane` from x = 100, driven `seconds` among `o`: its farthest x. */
function farthest(o: Obstacles, seconds = 30, lane = 0): number {
  const t = createTraffic(line, 1, 1, [{ edge: 0, s: 100, forward: true, lane, want: lane }]);
  let most = -Infinity;
  for (let n = 0; n < seconds * 60; n++) {
    t.update(1 / 60, null, o);
    most = Math.max(most, t.x[0]);
  }
  return most;
}

/** FNV-1a over the float bits of every car's position and heading. */
function hashOf(t: Traffic): number {
  const bits = new Uint32Array(new Float32Array([...t.x, ...t.z, ...t.heading]).buffer);
  let h = 0x811c9dc5;
  for (const b of bits) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

describe("traffic and obstacles", () => {
  it("drives as before with no obstacles: the same positions after 30 s", () => {
    const around = { x: 200, z: 200, r: 300 };
    // This test's first run (`update(dt, around)`, no obstacles) at 036312a, before the traffic
    // saw obstacles.
    const before = 1284574796;
    const runs = [undefined, null, obstaclesAt()].map((none) => {
      const t = createTraffic(ring, 150, 4);
      for (let n = 0; n < 30 * 60; n++) t.update(1 / 60, around, none);
      return hashOf(t);
    });
    expect(runs).toEqual([before, before, before]);
  });

  it("a car turning across the node stops short of a car parked in its mouth", () => {
    // A street east to the node at (0, 0), then off it to the left, south (-z): the car comes in
    // on the lane at z = 1.5 and swings across the box to x = 1.5.
    const bend = graphOf(
      [-100, 0, 0, 0, 0, -100],
      [
        [0, 1, ROAD.street],
        [1, 2, ROAD.street],
      ],
    );
    const t = createTraffic(bend, 1, 1, [{ edge: 0, s: 50, forward: true, lane: 0, want: 0 }]);
    // A disc of a parked car 1 m past the node, in the lane the car comes in on: past the end of
    // its road, and 1.5 m back from the start of the one it leaves by.
    const o = obstaclesAt([1, 0, 1.5, 1.2]);
    let most = -Infinity;
    for (let n = 0; n < 20 * 60; n++) {
      t.update(1 / 60, null, o);
      most = Math.max(most, t.x[0]);
    }
    expect(most).toBeGreaterThan(-20);
    // `MIN_GAP` along the way: 100 m to the node, then 1.5 m back.
    expect(most).toBeLessThanOrEqual(-(MIN_GAP + 1.5) + 1e-3);
  });

  it("a car stops for a person 1.4 m off its lane's centre", () => {
    const most = farthest(obstaclesAt([300, 0, 2 + 1.4, 0.35]));
    expect(most).toBeLessThanOrEqual(300 - MIN_GAP + 1e-3);
  });

  it("a car stops short of the player's car in its lane", () => {
    const most = farthest(obstaclesAt([300, 0, 2, 1.2]));
    expect(most).toBeGreaterThan(280);
    expect(most).toBeLessThanOrEqual(300 - MIN_GAP + 1e-3);
  });

  it("a car stops short of a person on the road", () => {
    const most = farthest(obstaclesAt([300, 0, 2.6, 0.35]));
    expect(most).toBeGreaterThan(280);
    expect(most).toBeLessThanOrEqual(300 - MIN_GAP + 1e-3);
  });

  it("a car drives on past one in the next lane, across the road or overhead", () => {
    const by: At[] = [
      [300, 0, 6, 1.2],
      [300, 0, -2, 1.2],
      [300, 5, 2, 1.2],
    ];
    for (const o of by) expect(farthest(obstaclesAt(o), 20), `${o}`).toBeGreaterThan(400);
  });

  it("no car is put back near an obstacle", () => {
    const around = { x: 200, z: 0, r: 150 };
    const o = obstaclesAt([200, 0, 2, 1.2]);
    const t = createTraffic(ring, 60, 2);
    const was = Uint8Array.from(t.live);
    let back = 0;
    for (let n = 0; n < 60 * 60; n++) {
      if (n % 30 === 0) t.live[(n / 30) % t.count] = 0; // taken by the player
      was.set(t.live);
      t.update(1 / 60, around, o);
      for (let i = 0; i < t.count; i++) {
        if (t.air[i] || was[i] || !t.live[i]) continue;
        back++;
        expect(Math.hypot(t.x[i] - 200, t.z[i] - 2)).toBeGreaterThanOrEqual(CAR_SPACING - 1e-3);
      }
    }
    expect(back).toBeGreaterThan(5);
  });
});

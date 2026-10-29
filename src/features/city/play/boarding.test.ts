import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import type { Traffic } from "../actors/traffic";
import { canalWorld } from "../physics/world.fixture";
import walkerUrl from "../assets/walker.glb?inline";
import { BEHIND, BESIDE, CLIP, doorOf, exitSpot, fromCar, nearestDoor, toCar } from "./boarding";
import { createCar } from "./vehicle";

const EAST = Math.PI / 2;
/** A 40 m house at x 20…40, z 20…40. */
const TOWER = { x: 20, z: 20, w: 20, d: 20, h: 40 };

/** Ground cars of the traffic at (x, 0, z), heading +z; `air` flags flying ones. */
const traffic = (xz: [number, number][], air: number[] = []): Traffic => ({
  count: xz.length,
  x: Float32Array.from(xz, ([x]) => x),
  y: new Float32Array(xz.length),
  z: Float32Array.from(xz, ([, z]) => z),
  heading: new Float32Array(xz.length),
  air: Uint8Array.from(xz, (_, i) => (air.includes(i) ? 1 : 0)),
  appear: new Float32Array(xz.length).fill(1),
  live: new Uint8Array(xz.length).fill(1),
  update: () => {},
});

describe("the car's frame", () => {
  it("has its left at +x for a car nosed to +z, and goes there and back", () => {
    const out = { x: 0, z: 0 };
    fromCar(1, 0, 10, 20, 0, out);
    expect(out.x).toBeGreaterThan(10);
    expect(out.z).toBeCloseTo(20);
    fromCar(0.3, -1.2, 10, 20, 2.1, out);
    toCar(out.x, out.z, 10, 20, 2.1, out);
    expect(out.x).toBeCloseTo(0.3);
    expect(out.z).toBeCloseTo(-1.2);
  });

  it("matches walker.glb: its car clips' lengths and where they stand", async () => {
    const data = await (await fetch(walkerUrl)).arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(data, "");
    const spots = gltf.scene.userData.car_clips as Record<
      string,
      { position: number[]; quaternion: number[] }
    >;
    for (const [name, clip] of [
      ["Enter_Car", CLIP.enter],
      ["Exit_Car", CLIP.exit],
    ] as const) {
      expect(gltf.animations.find((a) => a.name === name)?.duration).toBeCloseTo(clip.length, 5);
      const { position, quaternion } = spots[name];
      expect(position[0]).toBeCloseTo(clip.x, 6);
      expect(position[2]).toBeCloseTo(clip.z, 6);
      expect(2 * Math.atan2(quaternion[1], quaternion[3])).toBeCloseTo(clip.yaw, 6);
    }
  });
});

describe("nearestDoor", () => {
  it("finds the driver's door within 3 m, of an empty car or a ground car of the traffic", () => {
    const { solids } = canalWorld();
    const parked = createCar(60, 60, 0, solids, "empty");
    const door = doorOf(60, 60, 0, { x: 0, z: 0 });
    expect(nearestDoor(door.x + 2.5, 0, door.z, [parked], null)).toMatchObject({
      kind: "car",
      index: 0,
    });
    expect(nearestDoor(door.x + 3.5, 0, door.z, [parked], null)).toBeNull();
    // Not a car someone is in.
    const taken = createCar(60, 60, 0, solids, "player");
    expect(nearestDoor(door.x + 1, 0, door.z, [taken], null)).toBeNull();
    // The nearer of two; a flying one or one off the roads is not reached.
    const t = traffic(
      [
        [59, 60],
        [61, 60],
        [60.5, 60],
      ],
      [2],
    );
    t.live[1] = 0;
    expect(nearestDoor(door.x + 1, 0, door.z, [parked], t)).toMatchObject({
      kind: "car",
      index: 0,
    });
    expect(nearestDoor(door.x + 1, 0, door.z, [], t)).toMatchObject({ kind: "traffic", index: 0 });
  });

  it("does not reach a car on a roof from the street below, only from the roof", () => {
    const { solids } = canalWorld([TOWER]);
    const roof = createCar(38, 30, 0, solids, "empty");
    expect(roof.y).toBe(40);
    const door = doorOf(38, 30, 0, { x: 0, z: 0 });
    expect(nearestDoor(door.x + 1, 0, door.z, [roof], null)).toBeNull();
    expect(nearestDoor(door.x - 1, 40, door.z, [roof], null)).not.toBeNull();
  });
});

describe("exitSpot", () => {
  const out = { x: 0, z: 0 };

  it("steps out by the driver's door: on its left, +x for a car nosed to +z", () => {
    const { solids } = canalWorld();
    const c = createCar(60, 60, 0, solids, "player");
    expect(exitSpot(c, solids, out)).toBe("door");
    expect(out.x).toBeCloseTo(60 + BESIDE);
    expect(out.z).toBeCloseTo(60);
  });

  it("on a roof by its edge, steps out on the roof side, never down to the street", () => {
    const { solids } = canalWorld([TOWER]);
    // Nose to +z at x = 38.5: its left (+x) is past the edge at x = 40.
    const c = createCar(38.5, 30, 0, solids, "player");
    expect(exitSpot(c, solids, out)).toBe("other");
    expect(out.x).toBeCloseTo(38.5 - BESIDE);
    expect(solids.heightAt(out.x, out.z)).toBe(40);
  });

  it("with water on one side and a house on the other, out the back; boxed in, stays in", () => {
    // On the canal bridge (deck at 1 m, z 45…55) by its south edge, a house on its north side.
    const { solids } = canalWorld([{ x: 95, z: 47.5, w: 10, d: 5, h: 20 }]);
    // Nose to +x: the left is -z (past the deck's edge, water), the right +z (the house).
    const c = createCar(100, 46, EAST, solids, "player");
    expect(c.y).toBeCloseTo(1);
    expect(exitSpot(c, solids, out)).toBe("back");
    expect(out.x).toBeCloseTo(100 - BEHIND);
    expect(solids.isWater(out.x, out.z, 1 + 0.5)).toBe(false);
    // A house behind it too: no way out.
    const shut = canalWorld([
      { x: 95, z: 47.5, w: 10, d: 5, h: 20 },
      { x: 95, z: 45, w: 3, d: 2.5, h: 20 },
    ]).solids;
    expect(exitSpot(createCar(100, 46, EAST, shut, "player"), shut, out)).toBeNull();
    // Without the house it steps out on the deck, on its right.
    const open = canalWorld().solids;
    expect(exitSpot(createCar(100, 46, EAST, open, "player"), open, out)).toBe("other");
    expect(out.z).toBeCloseTo(46 + BESIDE);
  });

  it("does not step out into a taller house beside it", () => {
    const { solids } = canalWorld([
      { x: 50, z: 61.5, w: 20, d: 10, h: 6 },
      { x: 50, z: 48.5, w: 20, d: 10, h: 6 },
    ]);
    expect(exitSpot(createCar(60, 60, 0, solids, "player"), solids, out)).toBe("door");
    const boxed = createCar(60, 60, EAST, solids, "player");
    expect(exitSpot(boxed, solids, out)).toBe("back");
    expect(solids.roofAt(out.x, out.z)).toBeNull();
  });
});

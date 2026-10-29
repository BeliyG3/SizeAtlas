import { describe, expect, it } from "vitest";
import { CLIP } from "./boarding";
import { enterScript, exitScript, makeScriptPose, poseAt } from "./boardingScript";

const sp = makeScriptPose();

describe("enterScript", () => {
  it("starts where the person stands at its own size and ends seated, hands on, the door shut", () => {
    const s = enterScript({ x: 4, z: 1 }, 0.3);
    poseAt(s, 0, sp);
    expect([sp.x, sp.z, sp.yaw, sp.fit, sp.door, sp.ik]).toEqual([4, 1, 0.3, 0, 0, 0]);
    poseAt(s, s.length, sp);
    expect(sp.x).toBeCloseTo(CLIP.enter.x);
    expect(sp.z).toBeCloseTo(CLIP.enter.z);
    expect(Math.cos(sp.yaw - CLIP.enter.yaw)).toBeCloseTo(1);
    expect([sp.a, sp.aw, sp.fit, sp.door, sp.ik]).toEqual(["Enter_Car", 1, 1, 0, 1]);
    expect(sp.at).toBeCloseTo(CLIP.enter.length, 2);
    // The door is open while the clip plays.
    poseAt(s, s.length - 2, sp);
    expect([sp.a, sp.door]).toEqual(["Enter_Car", 1]);
  });
});

describe("exitScript", () => {
  it("ends at the spot given, at the person's own size, the door shut", () => {
    const s = exitScript({ x: 2.9, z: 0 });
    poseAt(s, 0, sp);
    expect([sp.a, sp.ik, sp.fit]).toEqual(["Enter_Car", 1, 1]);
    poseAt(s, s.length, sp);
    expect(sp.x).toBeCloseTo(2.9);
    expect(sp.z).toBeCloseTo(0);
    expect([sp.fit, sp.door, sp.ik]).toEqual([0, 0, 0]);
    expect(s.length).toBeGreaterThan(CLIP.exit.length + 1.5);
  });
});

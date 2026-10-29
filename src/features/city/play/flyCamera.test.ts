import { describe, expect, it } from "vitest";
import { makeActions } from "./input";
import { stepFly, turnFly, type Fly } from "./flyCamera";

const at = (): Fly => ({ x: 0, y: 10, z: 0, yaw: 0, pitch: 0 });

describe("the fly camera", () => {
  it("flies forward toward -z at yaw 0 and strafes to +x", () => {
    const f = at();
    const a = makeActions();
    a.move.y = 1;
    stepFly(f, a, 1);
    expect(f.z).toBeCloseTo(-20);
    expect(f.x).toBeCloseTo(0);
    a.move = { x: 1, y: 0 };
    stepFly(f, a, 1);
    expect(f.x).toBeCloseTo(20);
  });

  it("never goes under the eye height and never looks past straight down", () => {
    const f = at();
    turnFly(f, { x: 0, y: 10 });
    expect(f.pitch).toBeCloseTo(-1.5);
    const a = makeActions();
    a.move.y = 1;
    stepFly(f, a, 5);
    expect(f.y).toBeCloseTo(1.7);
  });
});

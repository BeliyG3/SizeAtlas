import { describe, expect, it } from "vitest";
import { group } from "../dup.testSupport";
import { picturePosition, stepPicture } from "./step";

const groups = [
  group("a", 1, { name: "a.jpg" }),
  group("b", 1, { name: "b.txt" }),
  group("c", 1, { name: "c.png" }),
];

describe("stepPicture", () => {
  it("skips the groups without a picture type and stops at the ends", () => {
    expect(stepPicture(groups, 0, 1)).toBe(2);
    expect(stepPicture(groups, 2, -1)).toBe(0);
    expect(stepPicture(groups, 2, 1)).toBeNull();
    expect(stepPicture(groups, 0, -1)).toBeNull();
  });
});

describe("picturePosition", () => {
  it("counts only the groups with a picture type", () => {
    expect(picturePosition(groups, 0)).toEqual({ position: 1, total: 2 });
    expect(picturePosition(groups, 2)).toEqual({ position: 2, total: 2 });
  });
});

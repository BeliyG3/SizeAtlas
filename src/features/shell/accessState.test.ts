import { describe, expect, it } from "vitest";
import { actionable } from "./accessState";

describe("actionable", () => {
  it("is true on Windows without administrator rights", () => {
    expect(actionable("windows", false, null)).toBe(true);
  });

  it("is false for an administrator", () => {
    expect(actionable("windows", true, null)).toBe(false);
  });

  it("is unknown while the rights of the process are unknown", () => {
    expect(actionable("windows", null, null)).toBeNull();
  });

  it("is true on a Mac without Full Disk Access, false with it, unknown before the answer", () => {
    expect(actionable("mac", null, false)).toBe(true);
    expect(actionable("mac", null, true)).toBe(false);
    expect(actionable("mac", null, null)).toBeNull();
  });

  it("is false elsewhere: there is no button besides Show", () => {
    expect(actionable("other", null, null)).toBe(false);
  });
});

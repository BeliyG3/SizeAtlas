import { describe, expect, it } from "vitest";
import { displayVersion, wixVersion } from "./version";

describe("displayVersion", () => {
  it("drops the release number of the first release of a month", () => {
    expect(displayVersion("2026.10.0")).toBe("2026.10");
    expect(displayVersion("2027.1.0")).toBe("2027.1");
  });

  it("keeps later releases of the month as they are", () => {
    expect(displayVersion("2026.10.1")).toBe("2026.10.1");
    expect(displayVersion("2026.10.10")).toBe("2026.10.10");
  });
});

describe("wixVersion", () => {
  it("keeps the last two digits of the year", () => {
    expect(wixVersion("2026.10.0")).toBe("26.10.0");
    expect(wixVersion("2027.1.12")).toBe("27.1.12");
  });
});

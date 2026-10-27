import { describe, expect, it } from "vitest";
import {
  parseShown,
  parseSize,
  parseTheme,
  parseUnit,
  resolveTheme,
  serializeShown,
} from "./settings";

describe("stored settings", () => {
  it("accept known values and fall back otherwise", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("blue")).toBe("system");
    expect(parseUnit("MB")).toBe("MB");
    expect(parseUnit("mb")).toBe("auto");
    expect(parseUnit(null)).toBe("auto");
  });

  it("parse stored pixel sizes and reject garbage", () => {
    expect(parseSize("320", 100)).toBe(320);
    expect(parseSize("12.6", 100)).toBe(13);
    for (const raw of [null, "", "-5", "0", "NaN", "1e9", "wide"]) {
      expect(parseSize(raw, 100)).toBe(100);
    }
  });

  it("resolve the system theme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("show a panel unless it was stored as hidden", () => {
    expect(parseShown(null)).toBe(true);
    expect(parseShown("1")).toBe(true);
    expect(parseShown("0")).toBe(false);
    expect(parseShown("garbage")).toBe(true);
    expect(serializeShown(false)).toBe("0");
    expect(parseShown(serializeShown(true))).toBe(true);
  });

  it("hide a panel that is off by default until it was stored as shown", () => {
    expect(parseShown(null, false)).toBe(false);
    expect(parseShown("garbage", false)).toBe(false);
    expect(parseShown("0", false)).toBe(false);
    expect(parseShown(serializeShown(true), false)).toBe(true);
  });
});

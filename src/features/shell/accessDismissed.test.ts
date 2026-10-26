import { describe, expect, it } from "vitest";
import { isScanDismissed, parseDismissed } from "./accessDismissed";

describe("access dismissal", () => {
  it("remembers one scan of one root", () => {
    const stored = parseDismissed(JSON.stringify({ "C:\\": 100 }));
    expect(isScanDismissed(stored, "C:\\", 100)).toBe(true);
    // A rescan has a new time: the banner returns.
    expect(isScanDismissed(stored, "C:\\", 200)).toBe(false);
    expect(isScanDismissed(stored, "D:\\", 100)).toBe(false);
  });

  it.each([null, "", "{", "null", "7", '"text"', "[1,2]"])(
    "dismisses nothing for the stored value %j",
    (raw) => {
      expect(parseDismissed(raw)).toEqual({});
    },
  );

  it("drops the entries that are not times", () => {
    expect(parseDismissed(JSON.stringify({ a: 1, b: "2", c: null, d: {} }))).toEqual({ a: 1 });
  });
});

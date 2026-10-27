import { describe, expect, it } from "vitest";
import { DUP_QUERY_KEY, DUP_SYSTEM_KEY, parseDupQuery, parseDupSystem } from "./query";

describe("the stored search of the duplicates", () => {
  it("starts with the images and keeps a cleared field cleared", () => {
    expect(parseDupQuery(null)).toBe("type:image");
    expect(parseDupQuery("")).toBe("");
    expect(parseDupQuery("*.mp4")).toBe("*.mp4");
  });

  it("leaves the system folders out unless they were included", () => {
    expect(parseDupSystem(null)).toBe(false);
    expect(parseDupSystem("0")).toBe(false);
    expect(parseDupSystem("junk")).toBe(false);
    expect(parseDupSystem("1")).toBe(true);
  });

  it("is kept under keys of its own", () => {
    expect(DUP_QUERY_KEY).toBe("sizeatlas.duplicates.query");
    expect(DUP_SYSTEM_KEY).toBe("sizeatlas.duplicates.system");
  });
});

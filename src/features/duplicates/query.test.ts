import { describe, expect, it } from "vitest";
import {
  DUP_EVERYWHERE_KEY,
  DUP_QUERY_KEY,
  DUP_SYSTEM_KEY,
  parseDupEverywhere,
  parseDupQuery,
  parseDupSystem,
} from "./query";

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

  it("searches the selected folder unless every open drive was chosen", () => {
    expect(parseDupEverywhere(null)).toBe(false);
    expect(parseDupEverywhere("0")).toBe(false);
    expect(parseDupEverywhere("1")).toBe(true);
  });

  it("is kept under keys of its own", () => {
    expect(DUP_QUERY_KEY).toBe("sizeatlas.duplicates.query");
    expect(DUP_SYSTEM_KEY).toBe("sizeatlas.duplicates.system");
    expect(DUP_EVERYWHERE_KEY).toBe("sizeatlas.duplicates.everywhere");
  });
});

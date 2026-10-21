import { describe, expect, it } from "vitest";
import { neighbour } from "./neighbour";

describe("neighbour", () => {
  const ids = ["file", "scan", "view", "help", "language"];

  it("steps to the next title on either side, the globe after Help", () => {
    expect(neighbour(ids, "help", 1)).toBe("language");
    expect(neighbour(ids, "language", -1)).toBe("help");
    expect(neighbour(ids, "scan", -1)).toBe("file");
  });

  it("wraps around at both ends", () => {
    expect(neighbour(ids, "language", 1)).toBe("file");
    expect(neighbour(ids, "file", -1)).toBe("language");
  });
});

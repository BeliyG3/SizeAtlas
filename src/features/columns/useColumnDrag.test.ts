import { describe, expect, it } from "vitest";
import { alignsEnd } from "./useColumnDrag";

describe("header alignment", () => {
  it("reads the end alignment of a header label in either direction", () => {
    expect(alignsEnd({ textAlign: "end", justifyContent: "normal" }, false)).toBe(true);
    expect(alignsEnd({ textAlign: "end", justifyContent: "normal" }, true)).toBe(true);
    expect(alignsEnd({ textAlign: "start", justifyContent: "flex-end" }, true)).toBe(true);
    expect(alignsEnd({ textAlign: "right", justifyContent: "normal" }, false)).toBe(true);
    expect(alignsEnd({ textAlign: "right", justifyContent: "normal" }, true)).toBe(false);
    expect(alignsEnd({ textAlign: "left", justifyContent: "normal" }, true)).toBe(true);
    expect(alignsEnd({ textAlign: "start", justifyContent: "normal" }, false)).toBe(false);
  });
});

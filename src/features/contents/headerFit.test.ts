import { describe, expect, it } from "vitest";
import { headerWidths } from "./headerFit";

describe("headerWidths", () => {
  const defaults = { name: 280, dirs: 88 } as const;

  it("widens a column whose label and sort arrow do not fit its default", () => {
    // 100 px label + 16 px padding and gap + 10 px arrow + the fit slack.
    expect(headerWidths(defaults, (id) => (id === "dirs" ? 100 : 40), 10)).toEqual({
      name: 280,
      dirs: 130,
    });
  });

  it("never narrows a default", () => {
    expect(headerWidths(defaults, () => 0, 0)).toEqual(defaults);
  });
});

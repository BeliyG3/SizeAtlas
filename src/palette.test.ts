import { describe, expect, it } from "vitest";
import en from "./i18n/locales/en.json";
import { CATEGORY_NAMES, PALETTES } from "./palette";

describe("palette", () => {
  it("has an English name for each of the 8 core categories", () => {
    expect(CATEGORY_NAMES).toHaveLength(8);
    for (const name of CATEGORY_NAMES) expect(en).toHaveProperty([`category.${name}`]);
  });

  it("gives each theme a full set of colors", () => {
    for (const theme of ["dark", "light"] as const) {
      expect(PALETTES[theme].categories).toHaveLength(8);
      expect(PALETTES[theme].slices).toHaveLength(10);
    }
    expect(PALETTES.light.dirFill).not.toBe(PALETTES.dark.dirFill);
  });
});

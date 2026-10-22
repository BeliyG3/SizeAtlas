import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import { MODE_MENU, MODES, isListMode, parseMode } from "./modes";

describe("table modes", () => {
  it("restore the stored mode, the values of the old switch included", () => {
    expect(parseMode("folders")).toBe("folders");
    expect(parseMode("all")).toBe("all");
    expect(parseMode("oldestFiles")).toBe("oldestFiles");
    expect(parseMode(null)).toBe("all");
    expect(parseMode("files")).toBe("all");
  });

  it("offer every mode once, each with a label", () => {
    expect(MODES).toHaveLength(17);
    expect(new Set(MODES).size).toBe(MODES.length);
    for (const mode of MODES) expect(en).toHaveProperty([`mode.${mode}`]);
    for (const entry of MODE_MENU) {
      if (typeof entry === "object") expect(en).toHaveProperty([`mode.${entry.submenu}Menu`]);
    }
  });

  it("tell the flat lists from the folder views", () => {
    expect(isListMode("all")).toBe(false);
    expect(isListMode("folders")).toBe(false);
    expect(MODES.filter(isListMode)).toHaveLength(15);
  });

  it("end the group of the largest with Grew most", () => {
    const at = MODE_MENU.indexOf("largestFiles");
    expect(MODE_MENU.slice(at, at + 5)).toEqual([
      "largestFiles",
      "largestFolders",
      "largest",
      "grewMost",
      "-",
    ]);
  });
});

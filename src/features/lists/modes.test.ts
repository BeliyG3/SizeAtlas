import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import { MODE_MENU, MODES, isListMode, listShown, parseMode } from "./modes";

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

  it("never offer or restore search as a mode: a query shows it over any mode", () => {
    expect(MODES as readonly string[]).not.toContain("search");
    expect(JSON.stringify(MODE_MENU)).not.toContain("search");
    expect(parseMode("search")).toBe("all");
    expect(en).toHaveProperty(["mode.search"]);
  });

  it("show the search results over any mode while the query has words", () => {
    expect(listShown("all", "backup")).toBe("search");
    expect(listShown("largest", " *.mp4 ")).toBe("search");
    expect(listShown("largest", "")).toBe("largest");
    expect(listShown("folders", "   ")).toBeNull();
    expect(listShown("all", "")).toBeNull();
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

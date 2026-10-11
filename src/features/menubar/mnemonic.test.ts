import { describe, expect, it } from "vitest";
import { LANGUAGES, translate } from "../../i18n/index";
import { mnemonic } from "./mnemonic";

describe("menu titles", () => {
  it("take the letter after & as the key", () => {
    expect(mnemonic("&File")).toEqual({ text: "File", at: 0, key: "f" });
    expect(mnemonic("Спр&авка")).toEqual({ text: "Справка", at: 3, key: "а" });
    expect(mnemonic("Plain")).toEqual({ text: "Plain", at: -1, key: null });
    expect(mnemonic("End&")).toEqual({ text: "End", at: -1, key: null });
  });

  it("give every menu of every language its own letter", () => {
    for (const { code } of LANGUAGES) {
      const keys = ["file", "scan", "view", "help"].map(
        (id) => mnemonic(translate(code, `menubar.${id}`)).key,
      );
      expect(keys).not.toContain(null);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

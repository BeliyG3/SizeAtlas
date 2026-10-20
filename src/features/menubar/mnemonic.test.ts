import { describe, expect, it } from "vitest";
import { LANGUAGES, translate } from "../../i18n/index";
import { mnemonic, mnemonicHit } from "./mnemonic";

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

describe("mnemonicHit", () => {
  it("matches the typed letter or, for a Latin mnemonic, the physical key", () => {
    expect(mnemonic("ファイル(&F)").text).toBe("ファイル(F)");
    expect(mnemonicHit("&File", "f", "KeyF")).toBe(true);
    expect(mnemonicHit("ファイル(&F)", "ب", "KeyF")).toBe(true);
    expect(mnemonicHit("&Файл", "ф", "KeyA")).toBe(true);
    expect(mnemonicHit("&Файл", "a", "KeyF")).toBe(false);
    expect(mnemonicHit("ファイル(&F)", "x", "KeyX")).toBe(false);
    expect(mnemonicHit("Plain", "p", "KeyP")).toBe(false);
  });
});

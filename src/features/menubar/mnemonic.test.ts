import { describe, expect, it } from "vitest";
import { LANGUAGES, translate } from "../../i18n/index";
import { mnemonic, mnemonicMenu } from "./mnemonic";

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

describe("mnemonicMenu", () => {
  const menu = (...labels: string[]) => labels.map((label) => ({ label }));

  it("matches the typed letter or, for a Latin mnemonic, the physical key", () => {
    expect(mnemonic("ファイル(&F)").text).toBe("ファイル(F)");
    expect(mnemonicMenu(menu("&File"), "f", "KeyF")?.label).toBe("&File");
    expect(mnemonicMenu(menu("ファイル(&F)"), "ب", "KeyF")?.label).toBe("ファイル(&F)");
    expect(mnemonicMenu(menu("&Файл"), "ф", "KeyA")?.label).toBe("&Файл");
    expect(mnemonicMenu(menu("&Файл"), "a", "KeyF")).toBeUndefined();
    expect(mnemonicMenu(menu("ファイル(&F)"), "x", "KeyX")).toBeUndefined();
    expect(mnemonicMenu(menu("Plain"), "p", "KeyP")).toBeUndefined();
  });

  it("takes the typed letter over an earlier menu's physical key (AZERTY: A where QWERTY has Q)", () => {
    expect(mnemonicMenu(menu("&Quit", "&About"), "a", "KeyQ")?.label).toBe("&About");
  });
});

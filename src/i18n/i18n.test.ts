import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  detectLang,
  intlLocale,
  isRtl,
  languageName,
  translate,
  translateWith,
} from "./index";
import { mnemonic } from "../features/menubar/mnemonic";

const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (messages: Record<string, string>) =>
  [...new Set(Object.keys(messages).map((k) => k.replace(PLURAL, "")))].sort();

describe("locales", () => {
  const en = LANGUAGES.find((l) => l.code === "en")!.messages;

  it("every locale has the same base keys as English", () => {
    for (const lang of LANGUAGES) expect(baseKeys(lang.messages)).toEqual(baseKeys(en));
  });

  it("every plural key has all forms its language needs", () => {
    for (const lang of LANGUAGES) {
      const forms = new Intl.PluralRules(lang.code).resolvedOptions().pluralCategories;
      const plural = new Set(
        Object.keys(lang.messages)
          .filter((k) => PLURAL.test(k))
          .map((k) => k.replace(PLURAL, "")),
      );
      for (const key of plural)
        for (const form of forms) expect(lang.messages).toHaveProperty([`${key}_${form}`]);
    }
  });

  it("placeholders match English", () => {
    const tokens = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
    for (const lang of LANGUAGES)
      for (const [key, text] of Object.entries(lang.messages)) {
        const english = en[PLURAL.test(key) ? key.replace(PLURAL, "_other") : key];
        expect(tokens(text), `${lang.code} ${key}`).toEqual(tokens(english));
      }
  });

  it("size units are six names", () => {
    for (const lang of LANGUAGES) {
      const units = lang.messages["size.units"].split(",");
      expect(units, lang.code).toHaveLength(6);
      for (const unit of units) expect(unit.trim(), lang.code).not.toBe("");
    }
  });

  it("language names are non-empty and not English outside English", () => {
    for (const lang of LANGUAGES) {
      expect(lang.messages["lang.name"], lang.code).not.toBe("");
      if (lang.code !== "en")
        expect(lang.messages["lang.name"], lang.code).not.toBe(en["lang.name"]);
    }
  });

  it("top menus each have one mnemonic and the four keys differ", () => {
    for (const lang of LANGUAGES) {
      const keys = ["file", "scan", "view", "help"].map((menu) => {
        const title = lang.messages[`menubar.${menu}`];
        expect(title.split("&").length - 1, `${lang.code} ${menu}`).toBe(1);
        return mnemonic(title).key;
      });
      expect(keys, lang.code).not.toContain(null);
      expect(new Set(keys).size, lang.code).toBe(4);
    }
  });

  it("no mnemonic marker outside the top menus", () => {
    for (const lang of LANGUAGES)
      for (const [key, text] of Object.entries(lang.messages))
        if (!/^menubar\.(file|scan|view|help)$/.test(key))
          expect(text, `${lang.code} ${key}`).not.toMatch(/&\p{L}/u);
  });

  it("every CmdError code has a message", () => {
    for (const code of [
      "StaleId",
      "Busy",
      "Changed",
      "NoAccess",
      "CacheInvalid",
      "CacheOutdated",
      "CacheNotSaved",
      "LossyName",
      "NoTrash",
      "Cancelled",
      "Io",
    ])
      expect(en).toHaveProperty([`error.${code}`]);
  });
});

describe("translate", () => {
  it("chooses Russian plural forms", () => {
    const word = (n: number) => translate("ru", "tree.more", { count: n, size: "1 МБ" });
    expect(word(1)).toBe("Показать ещё 1 папку (1 МБ)");
    expect(word(3)).toContain("3 папки");
    expect(word(5)).toContain("5 папок");
    expect(word(11)).toContain("11 папок");
    expect(word(21)).toContain("21 папку");
    expect(word(1.5)).toContain("1.5 папки");
    expect(translate("en", "tree.more", { count: 1, size: "1 MB" })).toBe(
      "Show 1 more folder (1 MB)",
    );
    expect(translate("en", "tree.more", { count: 2, size: "1 MB" })).toContain("2 more folders");
  });

  it("pluralizes the status counts", () => {
    const files = (lang: "en" | "ru", n: number) =>
      translate(lang, "status.files", { count: n, files: String(n) });
    expect(files("ru", 1)).toBe("1 файл");
    expect(files("ru", 3)).toBe("3 файла");
    expect(files("ru", 5)).toBe("5 файлов");
    expect(files("ru", 21)).toBe("21 файл");
    expect(files("en", 1)).toBe("1 file");
    expect(files("en", 2)).toBe("2 files");
    expect(translate("ru", "status.dirs", { count: 2, dirs: "2" })).toBe("2 папки");
  });

  it("substitutes parameters", () => {
    expect(translate("en", "error.Io", { path: "C:\\x", osMessage: "boom" })).toBe("C:\\x: boom");
  });

  it("falls back to English, then to the key", () => {
    const catalogs = {
      en: { hello: "Hello", n_one: "{count} item", n_other: "{count} items" },
      ru: {},
    };
    expect(translateWith(catalogs, "ru", "hello")).toBe("Hello");
    expect(translateWith(catalogs, "ru", "n", { count: 2 })).toBe("2 items");
    expect(translateWith(catalogs, "ru", "missing")).toBe("missing");
  });

  it("names every language in its own locale file", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("ru")).toBe("Русский");
  });

  it("detects the language from preferences", () => {
    expect(detectLang(["ru-RU", "en"])).toBe("ru");
    expect(detectLang(["de-DE"])).toBe("en");
  });

  it("knows the right-to-left languages", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("ru")).toBe(false);
  });

  it.todo("maps system tags to the supported codes"); // enabled in Task 7, when the codes exist

  it("isolates parameters in right-to-left languages", () => {
    const catalogs = { en: { m: "Moved {name}" }, he: { m: "הועבר {name}" } };
    expect(translateWith(catalogs, "he", "m", { name: "a.mp4" })).toBe("הועבר ⁨a.mp4⁩");
    expect(translateWith(catalogs, "en", "m", { name: "a.mp4" })).toBe("Moved a.mp4");
  });

  it("isolates parameters by the displayed language, even on an English fallback", () => {
    const catalogs = { en: { m: "Moved {name}" }, ar: {} };
    expect(translateWith(catalogs, "ar", "m", { name: "a.mp4" })).toBe("Moved ⁨a.mp4⁩");
  });

  it("uses Western digits for Arabic and the language code otherwise", () => {
    expect(intlLocale("ar")).toBe("ar-u-nu-latn");
    expect(intlLocale("ru")).toBe("ru");
  });
});

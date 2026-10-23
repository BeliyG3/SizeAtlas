import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  detectLang,
  intlLocale,
  isRtl,
  languageName,
  mirrorArrow,
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
      "Protected",
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

  it("names the filter age units in the form of the number", () => {
    const unit = (lang: "en" | "pl", key: string, n: number) =>
      translate(lang, `filters.age.${key}`, { count: n });
    expect(unit("en", "d", 1)).toBe("day");
    expect(unit("en", "d", 2)).toBe("days");
    expect(unit("pl", "y", 1)).toBe("rok");
    expect(unit("pl", "y", 2)).toBe("lata");
    expect(unit("pl", "y", 5)).toBe("lat");
    expect(unit("pl", "y", 22)).toBe("lata");
    expect(unit("pl", "y", 1.5)).toBe("roku");
    expect(unit("pl", "m", 2)).toBe("miesiące");
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

  it("lists the languages sorted by code: ar, de, en, es, fr, he, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, uk, vi, zh-Hans", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual([
      "ar",
      "de",
      "en",
      "es",
      "fr",
      "he",
      "hi",
      "id",
      "it",
      "ja",
      "ko",
      "nl",
      "pl",
      "pt-BR",
      "ru",
      "th",
      "tr",
      "uk",
      "vi",
      "zh-Hans",
    ]);
  });

  it("marks exactly Arabic and Hebrew right-to-left in the language list", () => {
    // The View › Language items take their `dir` from isRtl (MenuChoice.test checks the markup).
    expect(LANGUAGES.filter((l) => isRtl(l.code)).map((l) => l.code)).toEqual(["ar", "he"]);
  });

  it("detects the language from preferences", () => {
    expect(detectLang(["ru-RU", "en"])).toBe("ru");
    expect(detectLang(["de-DE"])).toBe("de");
    expect(detectLang(["sv-SE"])).toBe("en");
  });

  it("knows the right-to-left languages", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("ru")).toBe(false);
  });

  it("swaps the horizontal arrows in right-to-left layouts", () => {
    // Menu bar: → goes to the previous menu; tree: ← expands and → collapses; submenu: ← opens.
    expect(mirrorArrow("ArrowRight", true)).toBe("ArrowLeft");
    expect(mirrorArrow("ArrowLeft", true)).toBe("ArrowRight");
    expect(mirrorArrow("ArrowRight", false)).toBe("ArrowRight");
    expect(mirrorArrow("ArrowUp", true)).toBe("ArrowUp");
    expect(mirrorArrow("Enter", true)).toBe("Enter");
  });

  it("maps system tags to the supported codes", () => {
    expect(detectLang(["iw-IL"])).toBe("he");
    expect(detectLang(["in-ID"])).toBe("id");
    expect(detectLang(["zh-CN"])).toBe("zh-Hans");
    expect(detectLang(["zh-Hans-CN"])).toBe("zh-Hans");
    expect(detectLang(["zh-TW"])).toBe("en");
    expect(detectLang(["zh-Hant"])).toBe("en");
    // An explicit Simplified script wins over a region that usually writes Traditional.
    expect(detectLang(["zh-Hans-HK"])).toBe("zh-Hans");
    expect(detectLang(["zh-Hans-MO"])).toBe("zh-Hans");
    expect(detectLang(["zh-HK"])).toBe("en");
    expect(detectLang(["pt-PT"])).toBe("pt-BR");
    expect(detectLang(["pt"])).toBe("pt-BR");
    expect(detectLang(["de-AT"])).toBe("de");
  });

  it("isolates parameters in right-to-left languages", () => {
    const catalogs = { en: { m: "Moved {name}" }, he: { m: "הועבר {name}" } };
    expect(translateWith(catalogs, "he", "m", { name: "a.mp4" })).toBe("הועבר \u2068a.mp4\u2069");
    expect(translateWith(catalogs, "en", "m", { name: "a.mp4" })).toBe("Moved a.mp4");
  });

  it("isolates parameters by the displayed language, even on an English fallback", () => {
    const catalogs = { en: { m: "Moved {name}" }, ar: {} };
    expect(translateWith(catalogs, "ar", "m", { name: "a.mp4" })).toBe("Moved \u2068a.mp4\u2069");
  });

  it("uses Western digits for Arabic and the language code otherwise", () => {
    expect(intlLocale("ar")).toBe("ar-u-nu-latn");
    expect(intlLocale("ru")).toBe("ru");
  });
});

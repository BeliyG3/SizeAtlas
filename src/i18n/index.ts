import en from "./locales/en.json";
import ru from "./locales/ru.json";

export type Messages = Readonly<Record<string, string>>;
export type Params = Readonly<Record<string, string | number>>;

/** Supported languages. To add one: add `locales/<code>.json` (with `lang.name`) and one line here. */
export const LANGUAGES = [
  { code: "en", messages: en as Messages },
  { code: "ru", messages: ru as Messages },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export const FALLBACK_LANG: Lang = "en";

const CATALOGS: Readonly<Record<string, Messages>> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.messages]),
);

export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    const hit = LANGUAGES.find((l) => l.code === base);
    if (hit) return hit.code;
  }
  return FALLBACK_LANG;
}

/** The language's own name, taken from its locale file (`lang.name`). */
export function languageName(lang: Lang): string {
  return translate(lang, "lang.name");
}

export function translate(lang: Lang, key: string, params: Params = {}): string {
  return translateWith(CATALOGS, lang, key, params);
}

/**
 * Looks `key` up in `lang` (plural form picked by `params.count` with that language's rules),
 * then in English with English rules, then returns the key itself.
 */
export function translateWith(
  catalogs: Readonly<Record<string, Messages>>,
  lang: string,
  key: string,
  params: Params = {},
): string {
  const template =
    lookup(catalogs, lang, key, params.count) ??
    lookup(catalogs, FALLBACK_LANG, key, params.count) ??
    key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function lookup(
  catalogs: Readonly<Record<string, Messages>>,
  lang: string,
  key: string,
  count: unknown,
) {
  const messages = catalogs[lang] ?? {};
  if (typeof count === "number") {
    const form = new Intl.PluralRules(lang).select(count);
    return messages[`${key}_${form}`] ?? messages[`${key}_other`];
  }
  return messages[key];
}

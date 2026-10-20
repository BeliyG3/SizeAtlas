import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import id from "./locales/id.json";
import it from "./locales/it.json";
import nl from "./locales/nl.json";
import pl from "./locales/pl.json";
import ptBR from "./locales/pt-BR.json";
import ru from "./locales/ru.json";
import tr from "./locales/tr.json";

export type Messages = Readonly<Record<string, string>>;
export type Params = Readonly<Record<string, string | number>>;

/**
 * Supported languages, sorted by code (the View › Language menu lists them in this order). To add
 * one: add `locales/<code>.json` (with `lang.name`) and one line here, in place.
 */
export const LANGUAGES = [
  { code: "de", messages: de as Messages },
  { code: "en", messages: en as Messages },
  { code: "es", messages: es as Messages },
  { code: "fr", messages: fr as Messages },
  { code: "id", messages: id as Messages },
  { code: "it", messages: it as Messages },
  { code: "nl", messages: nl as Messages },
  { code: "pl", messages: pl as Messages },
  { code: "pt-BR", messages: ptBR as Messages },
  { code: "ru", messages: ru as Messages },
  { code: "tr", messages: tr as Messages },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export const FALLBACK_LANG: Lang = "en";

const CATALOGS: Readonly<Record<string, Messages>> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.messages]),
);

const RTL = new Set(["ar", "he"]);

/** Right-to-left languages: the document direction flips and parameters are bidi-isolated. */
export function isRtl(lang: string): boolean {
  return RTL.has(lang);
}

/** The arrow key as a left-to-right layout means it: ← and → swap in right-to-left layouts. */
export function mirrorArrow(key: string, rtl: boolean): string {
  if (!rtl) return key;
  return key === "ArrowLeft" ? "ArrowRight" : key === "ArrowRight" ? "ArrowLeft" : key;
}

/** The `Intl` locale for a language; Arabic keeps Western digits. */
export function intlLocale(lang: string): string {
  return lang === "ar" ? "ar-u-nu-latn" : lang;
}

/** A system language tag as one of our codes (legacy codes and script/region variants folded); null if unsupported. */
function normalizeTag(tag: string): string | null {
  const [base = "", ...rest] = tag.toLowerCase().split("-");
  if (base === "iw") return "he";
  if (base === "in") return "id";
  if (base === "pt") return "pt-BR";
  if (base === "zh") {
    // Only Simplified Chinese is translated; Traditional falls through to English.
    return rest.some((p) => ["hant", "tw", "hk", "mo"].includes(p)) ? null : "zh-Hans";
  }
  return base;
}

export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const code = normalizeTag(tag);
    const hit = LANGUAGES.find((l) => l.code === code);
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
  // First-strong-isolate marks keep a left-to-right value (a path, a file name) from reordering the sentence.
  const [open, close] = isRtl(lang) ? ["⁨", "⁩"] : ["", ""];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? `${open}${String(params[name])}${close}` : match,
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

import { intlLocale, translate, type Lang } from "./i18n/index";
import type { SizeUnit } from "./settings/settings";

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Creating Intl formatters is slow; keep one per language and number of decimals. */
function numberFormat(lang: Lang, digits?: number): Intl.NumberFormat {
  const key = `${lang}:${digits ?? "auto"}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(
      intlLocale(lang),
      digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits },
    );
    numberFormats.set(key, format);
  }
  return format;
}

/** Power of 1024 of each fixed unit. */
const FIXED_POWER: Readonly<Record<Exclude<SizeUnit, "auto">, number>> = {
  B: 0,
  KB: 1,
  MB: 2,
  GB: 3,
};

/**
 * Size with base-1024 units from the locale file. "auto": 0 B, 1.50 KB, 512 KB, 42.3 TB;
 * a fixed unit: two decimals (bytes have none).
 */
export function formatSize(bytes: number, lang: Lang, fixed: SizeUnit = "auto"): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = translate(lang, "size.units").split(",");
  if (fixed !== "auto") {
    const power = FIXED_POWER[fixed];
    const number = numberFormat(lang, power === 0 ? 0 : 2).format(bytes / 1024 ** power);
    return `${number} ${units[power]}`;
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  let rounded = roundTo(value, digitsFor(value, unit));
  // Rounding can reach 1024 (1048575 B -> "1,024 KB"); show it in the next unit instead.
  if (rounded >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
    rounded = roundTo(value, digitsFor(value, unit));
  }
  const digits = digitsFor(rounded, unit); // 9.999 rounds to 10.00 -> show "10.0"
  const number = numberFormat(lang, digits).format(rounded);
  return `${number} ${units[unit]}`;
}

/** A change of size with its sign, "+12.4 GB" or "−3.1 GB" (U+2212); empty for no change. */
export function formatChange(delta: number, lang: Lang, unit: SizeUnit): string {
  if (delta === 0) return "";
  return `${delta > 0 ? "+" : "−"}${formatSize(Math.abs(delta), lang, unit)}`;
}

function digitsFor(value: number, unit: number): number {
  return unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
}

function roundTo(value: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

export function formatCount(n: number, lang: Lang): string {
  return numberFormat(lang).format(n);
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** Relative time such as "2 days ago" (localized) for a Unix time in seconds. */
export function formatAgo(epochSecs: number, nowMs: number, lang: Lang): string {
  if (!Number.isFinite(epochSecs)) return "";
  let value = (epochSecs * 1000 - nowMs) / 1000;
  // "auto" gives "now" for zero, but also "yesterday"/"the day before yesterday" for -1/-2 days; keep numbers.
  if (Math.abs(value) < 60) {
    return new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: "auto" }).format(0, "second");
  }
  const rtf = new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: "always" });
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), "year");
}

const percentFormats = new Map<string, Intl.NumberFormat>();

/** A share (0.125) as a localized percentage with one decimal: "12.5%", "12,5 %". */
export function formatPercent(share: number, lang: Lang): string {
  if (!Number.isFinite(share)) return "—";
  let format = percentFormats.get(lang);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(lang), {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    percentFormats.set(lang, format);
  }
  return format.format(share);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** Local date and time of milliseconds since the Unix epoch; a dash when unknown (null or 0). */
export function formatDate(ms: number | null, lang: Lang): string {
  if (ms === null || !Number.isFinite(ms) || ms === 0) return "—";
  let format = dateFormats.get(lang);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "short", timeStyle: "short" });
    dateFormats.set(lang, format);
  }
  return format.format(ms);
}

import { CATEGORY_NAMES } from "../../palette";

/*
 * The condition words of a search text, as the filters panel reads and writes them. The grammar
 * is the core's (core/src/tree/search/filters.rs): a word that is not a valid condition there is
 * a name word here, so the panel never hides a word the search takes as a condition and never
 * takes a name word for one. Keep the two in step.
 */

export const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
export type Unit = (typeof SIZE_UNITS)[number];

/** Days, weeks, months (30 days), years (365 days). */
export const AGE_UNITS = ["d", "w", "m", "y"] as const;
export type AgeUnit = (typeof AGE_UNITS)[number];

export type Category = (typeof CATEGORY_NAMES)[number];

/** The characters of a search text the core uses (MAX_QUERY in src-tauri/src/state/lists.rs). */
export const MAX_QUERY = 256;

/** Rust's `split_whitespace`: the Unicode White_Space property (U+FEFF is not part of it). */
const SPACES = /\p{White_Space}+/u;
const wordsOf = (text: string) => text.split(SPACES).filter(Boolean);

export interface UiFilters {
  /**
   * From (`>=`) and to (`<=`), the value included; both together are a range (`a..b`), also
   * included. A strict `>` or `<` typed by hand reads the same and is written back with `>=` / `<=`.
   */
  minSize?: { value: number; unit: Unit };
  maxSize?: { value: number; unit: Unit };
  olderThan?: { value: number; unit: AgeUnit };
  newerThan?: { value: number; unit: AgeUnit };
  /** Any of these; none means any type. */
  types: Category[];
  kind?: "files" | "folders";
}

/** The conditions made of a number and a unit. */
export type NumberField = "minSize" | "maxSize" | "olderThan" | "newerThan";

/** The words of a `type:` condition, by category: the first is the one that is written. */
const TYPE_WORDS: Record<Category, string[]> = {
  Video: ["video", "videos"],
  Images: ["images", "image"],
  Audio: ["audio"],
  Documents: ["documents", "document"],
  Archives: ["archives", "archive"],
  Code: ["code"],
  Executables: ["programs", "program"],
  Other: ["other"],
};

/** Unit words (lowercase) as the core takes them: Latin or Russian, base 1024. */
const UNITS: Record<string, [Unit, bigint]> = {
  b: ["B", 1n],
  б: ["B", 1n],
  kb: ["KB", 1n << 10n],
  кб: ["KB", 1n << 10n],
  mb: ["MB", 1n << 20n],
  мб: ["MB", 1n << 20n],
  gb: ["GB", 1n << 30n],
  гб: ["GB", 1n << 30n],
  tb: ["TB", 1n << 40n],
  тб: ["TB", 1n << 40n],
};
/** The entry of `table` for `key` if it has one of its own (a word like "constructor" has none). */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const U32_MAX = (1n << 32n) - 1n;
const DAYS: Record<AgeUnit, bigint> = { d: 1n, w: 7n, m: 30n, y: 365n };

interface Size {
  bytes: bigint;
  value: number;
  unit: Unit;
  /** Whether the word had a unit. */
  explicit: boolean;
}

/** `1`, `1.5GB`, `1,5гб`: bytes rounded down and capped like the core's `sized`; null if no size. */
function size(text: string): Size | null {
  const [, number, suffix] = /^([0-9.,]*)([^]*)$/.exec(text)!;
  const entry = suffix === "" ? (["B", 1n] as [Unit, bigint]) : own(UNITS, suffix);
  const match = /^([0-9]+)(?:[.,]([0-9]+))?$/.exec(number);
  if (!entry || !match) return null;
  const [unit, per] = entry;
  const whole = BigInt(match[1]);
  if (whole > U128_MAX) return null;
  const fraction = (match[2] ?? "").slice(0, 18);
  let bytes = whole * per;
  if (fraction) bytes += (BigInt(fraction) * per) / 10n ** BigInt(fraction.length);
  return {
    bytes: bytes > U64_MAX ? U64_MAX : bytes,
    value: Number(match[2] ? `${match[1]}.${match[2]}` : match[1]),
    unit,
    explicit: suffix !== "",
  };
}

/** `30d`, `2w`, `6m`, `1y` as the count and unit, if the days fit the core's u32. */
function age(text: string): { days: bigint; value: number; unit: AgeUnit } | null {
  const unit = text.slice(-1) as AgeUnit;
  const count = text.slice(0, -1);
  if (!own(DAYS, unit) || !/^[0-9]+$/.test(count)) return null;
  const days = BigInt(count) * DAYS[unit];
  return days > U32_MAX ? null : { days, value: Number(count), unit };
}

type Condition =
  | { kind: "min" | "max"; size: Size; limit: bigint }
  | { kind: "older" | "newer"; days: bigint; value: number; unit: AgeUnit }
  | { kind: "type"; category: Category }
  | { kind: "files" | "folders" };

/** The conditions a lowercase word stands for: none if it is a name word, two for a range. */
function condition(word: string): Condition[] {
  const dated = /^(older|newer):(.*)$/.exec(word);
  if (dated) {
    const a = age(dated[2]);
    return a ? [{ kind: dated[1] as "older" | "newer", ...a }] : [];
  }
  const typed = /^type:(.*)$/.exec(word);
  if (typed) {
    const category = CATEGORY_NAMES.find((c) => TYPE_WORDS[c].includes(typed[1]));
    return category ? [{ kind: "type", category }] : [];
  }
  if (word === "files" || word === "folders") return [{ kind: word }];
  const bound = /^(>=|<=|>|<)(.*)$/.exec(word);
  if (bound) {
    const s = size(bound[2]);
    if (!s) return [];
    // The limits as the core stores them: `>` is one byte more, `<` one byte less.
    if (bound[1][0] === ">") {
      const strict = bound[1] === ">" && s.bytes < U64_MAX;
      return [{ kind: "min", size: s, limit: strict ? s.bytes + 1n : s.bytes }];
    }
    // Nothing is smaller than 0 bytes: `<0` is a name word.
    if (bound[1] === "<") {
      return s.bytes === 0n ? [] : [{ kind: "max", size: s, limit: s.bytes - 1n }];
    }
    return [{ kind: "max", size: s, limit: s.bytes }];
  }
  const at = word.indexOf("..");
  if (at < 0) return [];
  const [from, to] = [size(word.slice(0, at)), size(word.slice(at + 2))];
  // Two bare numbers (`2019..2020`) are more likely a name than a range of bytes.
  if (!from || !to || from.bytes > to.bytes || !(from.explicit || to.explicit)) return [];
  return [
    { kind: "min", size: from, limit: from.bytes },
    { kind: "max", size: to, limit: to.bytes },
  ];
}

const SIZE_FIELDS: readonly NumberField[] = ["minSize", "maxSize"];

/** A number in plain digits (`String` writes 1e-7 and 1e21 with an exponent); null if no size can hold it. */
function plain(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!text.includes("e")) return text;
  if (value < 1) return value.toFixed(18).replace(/\.?0+$/, "") || "0";
  const whole = BigInt(Math.round(value));
  return whole > U128_MAX ? null : whole.toString();
}

/** Whether `value` and `unit` make a condition the core takes, not a name word. */
function writable(field: NumberField, value: number, unit: string): boolean {
  if (SIZE_FIELDS.includes(field))
    return plain(value) !== null && own(UNITS, unit.toLowerCase()) !== undefined;
  const per = own(DAYS, unit);
  return Number.isInteger(value) && per !== undefined && BigInt(value) * per <= U32_MAX;
}

/**
 * The number a panel box holds, if it is one the search understands: digits (a fraction of up to
 * 18 digits for a size, none for days) that fit. Else undefined, and the box keeps what was typed.
 */
export function numberFromText(field: NumberField, raw: string, unit: string): number | undefined {
  const form = SIZE_FIELDS.includes(field) ? /^[0-9]+(\.[0-9]{1,18})?$/ : /^[0-9]+$/;
  const value = Number(raw);
  return form.test(raw) && writable(field, value, unit) ? value : undefined;
}

/** The filters with the number of `field` set (to `unit`); removed if it has no value or cannot be written. */
export function withNumber(
  filters: UiFilters,
  field: NumberField,
  value: number | undefined,
  unit: string,
): UiFilters {
  const next = { ...filters };
  if (value === undefined || !writable(field, value, unit)) delete next[field];
  else if (field === "minSize" || field === "maxSize") next[field] = { value, unit: unit as Unit };
  else next[field] = { value, unit: unit as AgeUnit };
  return next;
}

/** The condition words of `text` as filters, and the other words, in order, with single spaces. */
export function parseFilters(text: string): { words: string; filters: UiFilters } {
  const filters: UiFilters = { types: [] };
  // The resolved limits (bytes, days) of the kept bounds, to tighten them like the core does.
  const best: Partial<Record<"min" | "max" | "older" | "newer", bigint>> = {};
  const names: string[] = [];
  const parts = wordsOf(text);
  for (let at = 0; at < parts.length; at++) {
    const lower = parts[at].toLowerCase();
    const next = parts[at + 1]?.toLowerCase();
    // A size with its unit set apart (`>1 GB`) is one condition of two words.
    const spaced = next !== undefined && own(UNITS, next) ? condition(lower + next) : [];
    const found = spaced.length > 0 ? spaced : condition(lower);
    if (found.length === 0) {
      names.push(parts[at]);
      continue;
    }
    if (spaced.length > 0) at++;
    for (const c of found) {
      if (c.kind === "min" || c.kind === "max") {
        const { value, unit } = c.size;
        const have = best[c.kind];
        if (have === undefined || (c.kind === "min" ? c.limit > have : c.limit < have)) {
          best[c.kind] = c.limit;
          filters[c.kind === "min" ? "minSize" : "maxSize"] = { value, unit };
        }
      } else if (c.kind === "older" || c.kind === "newer") {
        const have = best[c.kind];
        if (have === undefined || (c.kind === "older" ? c.days > have : c.days < have)) {
          best[c.kind] = c.days;
          filters[c.kind === "older" ? "olderThan" : "newerThan"] = {
            value: c.value,
            unit: c.unit,
          };
        }
      } else if (c.kind === "type") {
        if (!filters.types.includes(c.category)) filters.types.push(c.category);
      } else filters.kind = c.kind;
    }
  }
  return { words: names.join(" "), filters };
}

const sized = (s: { value: number; unit: Unit }) => `${plain(s.value) ?? "0"}${s.unit}`;
/** Bytes of a panel size, as the core counts them. */
const bytesOf = (s: { value: number; unit: Unit }) => size(sized(s).toLowerCase())?.bytes ?? 0n;

/**
 * The size words: `>=a`, `<=b`, or `a..b`, the value always included; two limits that make no
 * range (a > b) stay two words, which the core ANDs into an empty result.
 */
function sizeWords({ minSize: min, maxSize: max }: UiFilters): string[] {
  if (min && max && bytesOf(min) <= bytesOf(max)) return [`${sized(min)}..${sized(max)}`];
  return [...(min ? [`>=${sized(min)}`] : []), ...(max ? [`<=${sized(max)}`] : [])];
}

/** Limits that leave nothing: the lower size above the upper, "older than" longer than "within the last". */
export function conflicts({ minSize, maxSize, olderThan, newerThan }: UiFilters) {
  const days = (a: { value: number; unit: AgeUnit }) => a.value * Number(DAYS[a.unit]);
  return {
    size: !!minSize && !!maxSize && bytesOf(minSize) > bytesOf(maxSize),
    age: !!olderThan && !!newerThan && days(olderThan) > days(newerThan),
  };
}

/** `words` followed by the condition words of `filters` in their compact forms. */
export function formatFilters(words: string, filters: UiFilters): string {
  const { olderThan, newerThan, types, kind } = filters;
  return [
    wordsOf(words).join(" "),
    ...sizeWords(filters),
    ...(olderThan ? [`older:${plain(olderThan.value) ?? "0"}${olderThan.unit}`] : []),
    ...(newerThan ? [`newer:${plain(newerThan.value) ?? "0"}${newerThan.unit}`] : []),
    ...types.map((c) => `type:${TYPE_WORDS[c][0]}`),
    ...(kind ? [kind] : []),
  ]
    .filter(Boolean)
    .join(" ");
}

import type { KeyboardEvent } from "react";
import { useT } from "../../i18n/react";
import { CATEGORY_NAMES } from "../../palette";
import {
  AGE_UNITS,
  MAX_QUERY,
  SIZE_UNITS,
  conflicts,
  formatFilters,
  numberFromText,
  parseFilters,
  withNumber,
  type NumberField,
  type UiFilters,
} from "./filters";
import "./filters.css";

/** The unit each number shows while its condition is not in the text (and so has no unit of its own). */
export type Units = Record<NumberField, string>;
export const DEFAULT_UNITS: Units = {
  minSize: "MB",
  maxSize: "MB",
  olderThan: "y",
  newerThan: "d",
};

/** What was typed in a number box that is no condition (yet): it stays in the box. */
export type Drafts = Partial<Record<NumberField, string>>;

export const NUMBER_FIELDS: readonly NumberField[] = [
  "minSize",
  "maxSize",
  "olderThan",
  "newerThan",
];

interface Props {
  /** The search text: the panel shows its conditions and writes its changes into it. */
  text: string;
  onText: (text: string) => void;
  units: Units;
  /** The unit now shown for a number, to be remembered while its condition is absent. */
  onUnit: (field: NumberField, unit: string) => void;
  drafts: Drafts;
  /** The text of a number box that is no condition, or undefined once it is one (or empty). */
  onDraft: (field: NumberField, raw: string | undefined) => void;
  /** A change was not written: the text would be longer than the search takes. */
  tooLong: boolean;
  onTooLong: (tooLong: boolean) => void;
  onClose: () => void;
}

const KINDS = ["both", "files", "folders"] as const;

/** The condition controls of the search text: size, modified date, types, files or folders. */
export function FiltersPanel({
  text,
  onText,
  units,
  onUnit,
  drafts,
  onDraft,
  tooLong,
  onTooLong,
  onClose,
}: Props) {
  const { t } = useT();
  const { words, filters } = parseFilters(text);
  const bad = conflicts(filters);
  const unitOf = (field: NumberField) => filters[field]?.unit ?? units[field];

  /** Writes the filters into the text unless it would outgrow what the search takes. */
  const apply = (next: UiFilters): boolean => {
    const written = formatFilters(words, next);
    // The core counts characters (Unicode scalar values), not UTF-16 units.
    const fits = [...written].length <= MAX_QUERY;
    onTooLong(!fits);
    if (fits) onText(written);
    return fits;
  };
  const setNumber = (field: NumberField, raw: string) => {
    const unit = unitOf(field);
    onUnit(field, unit);
    // Only a number the search understands is a condition; else the box keeps what was typed.
    const value = numberFromText(field, raw, unit);
    const wrote = apply(withNumber(filters, field, value, unit));
    onDraft(field, raw !== "" && (value === undefined || !wrote) ? raw : undefined);
  };
  const setUnit = (field: NumberField, unit: string) => {
    onUnit(field, unit);
    const set = filters[field];
    if (set) apply(withNumber(filters, field, set.value, unit));
  };
  const toggle = (category: (typeof CATEGORY_NAMES)[number]) =>
    apply({
      ...filters,
      // In the order of the Types chart, whichever was ticked first.
      types: CATEGORY_NAMES.filter((c) =>
        c === category ? !filters.types.includes(c) : filters.types.includes(c),
      ),
    });
  const setKind = (kind: (typeof KINDS)[number]) =>
    apply({ ...filters, kind: kind === "both" ? undefined : kind });
  const clear = () => {
    onTooLong(false);
    for (const field of NUMBER_FIELDS) onDraft(field, undefined);
    onText(words);
  };

  const row = (
    field: NumberField,
    label: string,
    unitList: readonly string[],
    conflict: boolean,
    age = false,
  ) => (
    <div className="filters-row" key={field}>
      <label htmlFor={`filters-${field}`}>{label}</label>
      <input
        id={`filters-${field}`}
        type="number"
        min={0}
        step="any"
        name={field}
        aria-invalid={conflict || drafts[field] !== undefined}
        value={drafts[field] ?? filters[field]?.value ?? ""}
        onChange={(e) => setNumber(field, e.target.value)}
      />
      <select
        name={`${field}Unit`}
        aria-label={t("filters.unitOf", { label })}
        value={unitOf(field)}
        onChange={(e) => setUnit(field, e.target.value)}
      >
        {unitList.map((unit) => (
          <option key={unit} value={unit}>
            {age ? t(`filters.age.${unit}`) : unit}
          </option>
        ))}
      </select>
    </div>
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div className="filters" onKeyDown={onKeyDown}>
      <fieldset>
        <legend>{t("filters.size")}</legend>
        {row("minSize", t("filters.from"), SIZE_UNITS, bad.size)}
        {row("maxSize", t("filters.to"), SIZE_UNITS, bad.size)}
        {bad.size && (
          <p className="filters-hint" role="status" data-hint="size">
            {t("filters.hint.size")}
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>{t("filters.modified")}</legend>
        {row("olderThan", t("filters.older"), AGE_UNITS, bad.age, true)}
        {row("newerThan", t("filters.newer"), AGE_UNITS, bad.age, true)}
        {bad.age && (
          <p className="filters-hint" role="status" data-hint="age">
            {t("filters.hint.age")}
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>{t("filters.type")}</legend>
        <div className="filters-choices">
          {CATEGORY_NAMES.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                name="type"
                value={category}
                checked={filters.types.includes(category)}
                onChange={() => toggle(category)}
              />
              {t(`category.${category}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("filters.show")}</legend>
        <div className="filters-choices">
          {KINDS.map((kind) => (
            <label key={kind}>
              <input
                type="radio"
                name="kind"
                value={kind}
                checked={(filters.kind ?? "both") === kind}
                onChange={() => setKind(kind)}
              />
              {t(`filters.kind.${kind}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {tooLong && (
        <p className="filters-hint" role="status" data-hint="long">
          {t("filters.tooLong")}
        </p>
      )}
      <button
        name="clear"
        disabled={
          formatFilters("", filters) === "" && NUMBER_FIELDS.every((f) => drafts[f] === undefined)
        }
        onClick={clear}
      >
        {t("filters.clear")}
      </button>
    </div>
  );
}

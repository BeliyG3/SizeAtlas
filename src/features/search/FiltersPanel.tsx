import type { KeyboardEvent } from "react";
import { useT } from "../../i18n/react";
import { CATEGORY_NAMES } from "../../palette";
import {
  AGE_UNITS,
  SIZE_UNITS,
  formatFilters,
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

interface Props {
  /** The search text: the panel shows its conditions and writes its changes into it. */
  text: string;
  onText: (text: string) => void;
  units: Units;
  /** The unit now shown for a number, to be remembered while its condition is absent. */
  onUnit: (field: NumberField, unit: string) => void;
  onClose: () => void;
}

const KINDS = ["both", "files", "folders"] as const;

/** The condition controls of the search text: size, modified date, types, files or folders. */
export function FiltersPanel({ text, onText, units, onUnit, onClose }: Props) {
  const { t } = useT();
  const { words, filters } = parseFilters(text);
  const apply = (next: UiFilters) => onText(formatFilters(words, next));
  const unitOf = (field: NumberField) => filters[field]?.unit ?? units[field];

  const setNumber = (field: NumberField, raw: string) => {
    const unit = unitOf(field);
    onUnit(field, unit);
    // Only plain digits make a number the search understands; anything else removes the condition.
    apply(withNumber(filters, field, /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : undefined, unit));
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

  const row = (field: NumberField, label: string, unitList: readonly string[], age = false) => (
    <div className="filters-row" key={field}>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        name={field}
        aria-label={label}
        value={filters[field]?.value ?? ""}
        onChange={(e) => setNumber(field, e.target.value)}
      />
      <select
        name={`${field}Unit`}
        aria-label={t("filters.unit")}
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
        {row("minSize", t("filters.from"), SIZE_UNITS)}
        {row("maxSize", t("filters.to"), SIZE_UNITS)}
      </fieldset>
      <fieldset>
        <legend>{t("filters.modified")}</legend>
        {row("olderThan", t("filters.older"), AGE_UNITS, true)}
        {row("newerThan", t("filters.newer"), AGE_UNITS, true)}
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
      <button
        name="clear"
        disabled={formatFilters("", filters) === ""}
        onClick={() => onText(words)}
      >
        {t("filters.clear")}
      </button>
    </div>
  );
}

import type { KeyboardEvent, RefObject } from "react";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { FiltersButton } from "./FiltersButton";
import "./search.css";

interface Props {
  /** The text in the field, as typed. */
  value: string;
  onChange: (value: string) => void;
  /** Enter: search for the text now, without the pause. */
  onCommit: (value: string) => void;
  /** Ctrl+F focuses it (see useSearchKey). */
  inputRef: RefObject<HTMLInputElement | null>;
}

/** The toolbar's search field: a magnifier, the text, a button that clears it and one for the filters. */
export function SearchField({ value, onChange, onCommit, inputRef }: Props) {
  const { t } = useT();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter and Escape of an input method belong to its composition; WebKit ends it before the key (229).
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "ArrowDown" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Into the results, if any: the table puts its cursor on the first row.
      const results = document.querySelector<HTMLElement>("[data-search-results]");
      if (results) {
        e.preventDefault();
        results.focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onChange("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      onCommit(value);
    }
  };
  return (
    <div className="search" role="search">
      <Icon name="search" />
      <input
        ref={inputRef}
        type="text"
        dir="auto"
        value={value}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        spellCheck={false}
        autoComplete="off"
        // The search takes this many characters (MAX_QUERY in src-tauri/src/state/lists.rs).
        maxLength={256}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value !== "" && (
        <button
          className="clear"
          title={t("search.clear")}
          aria-label={t("search.clear")}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <Icon name="cancel" />
        </button>
      )}
      <FiltersButton value={value} onChange={onChange} />
    </div>
  );
}

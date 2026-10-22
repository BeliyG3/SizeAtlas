import type { KeyboardEvent, RefObject } from "react";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
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

/** The toolbar's search field: a magnifier, the text and a button that clears it. */
export function SearchField({ value, onChange, onCommit, inputRef }: Props) {
  const { t } = useT();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter and Escape of an input method belong to its composition; WebKit ends it before the key (229).
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Escape") {
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
    </div>
  );
}

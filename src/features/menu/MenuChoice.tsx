interface Props {
  /** "radio": one of a group; "check": an option that is on or off. */
  kind: "radio" | "check";
  checked: boolean;
  label: string;
  onPick: () => void;
  /** The label is in another language: its tag and direction, so its script renders as its own. */
  language?: { lang: string; dir: "ltr" | "rtl" };
}

/** A menu item with a mark: a dot on the chosen one of a group, a check mark on an option that is on. */
export function MenuChoice({ kind, checked, label, onPick, language }: Props) {
  return (
    <button
      role={kind === "radio" ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onPick}
    >
      <span className="check" aria-hidden="true">
        {checked ? (kind === "radio" ? "●" : "✓") : ""}
      </span>
      {language ? <span {...language}>{label}</span> : label}
    </button>
  );
}

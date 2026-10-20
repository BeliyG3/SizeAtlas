import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";

interface Props {
  /** "radio": one of a group; "check": an option that is on or off. */
  kind: "radio" | "check";
  checked: boolean;
  label: string;
  onPick: () => void;
  /** Drawn between the mark and the label (the source list); the label then starts further in. */
  icon?: IconName;
  /** Shown in the dim text color (an unavailable choice that can still be picked). */
  dim?: boolean;
  /** The label is in another language: its tag and direction, so its script renders as its own. */
  language?: { lang: string; dir: "ltr" | "rtl" };
}

/** A menu item with a mark: a dot on the chosen one of a group, a check mark on an option that is on. */
export function MenuChoice({ kind, checked, label, onPick, icon, dim, language }: Props) {
  return (
    <button
      role={kind === "radio" ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={checked}
      className={[icon && "iconic", dim && "dim"].filter(Boolean).join(" ") || undefined}
      onClick={onPick}
    >
      <span className="check" aria-hidden="true">
        {checked ? (kind === "radio" ? "●" : "✓") : ""}
      </span>
      {icon && <Icon name={icon} />}
      {language ? <span {...language}>{label}</span> : label}
    </button>
  );
}

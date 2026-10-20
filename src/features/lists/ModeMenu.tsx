import { useCallback, useState } from "react";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "../menu/Menu";
import { MenuChoice } from "../menu/MenuChoice";
import { anchorX } from "../menu/place";
import { SubMenu } from "../menu/SubMenu";
import { MODE_MENU, type Mode } from "./modes";

interface Props {
  value: Mode;
  onChange: (mode: Mode) => void;
}

/** The toolbar button that picks what the table shows, and its menu. */
export function ModeMenu({ value, onChange }: Props) {
  const { t, lang } = useT();
  const [at, setAt] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
  const close = useCallback(() => setAt(null), []);
  const show = (el: HTMLElement, keyboard: boolean) => {
    const box = el.getBoundingClientRect();
    setAt({ x: anchorX(box, isRtl(lang)), y: box.bottom, keyboard });
  };
  const choice = (mode: Mode) => (
    <MenuChoice
      key={mode}
      kind="radio"
      checked={mode === value}
      label={t(`mode.${mode}`)}
      onPick={() => onChange(mode)}
    />
  );
  return (
    <>
      <button
        className="mode with-icon"
        title={t("mode.label")}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        // Opens on press, as a menu bar does. A press while it is open closes it: the menu
        // closes itself on that press, before this handler runs with the old state.
        onPointerDown={(e) => {
          if (e.button === 0 && at === null) show(e.currentTarget, false);
        }}
        // The press must not take the focus from the menu it opened: its keys would stop working.
        onMouseDown={(e) => e.preventDefault()}
        // Enter and Space; a pointer click was handled on press.
        onClick={(e) => {
          if (e.detail === 0) show(e.currentTarget, true);
        }}
      >
        <Icon name="list" />
        {t(`mode.${value}`)}
        <Icon name="chevron-down" />
      </button>
      {at && (
        <Menu x={at.x} y={at.y} label={t("mode.label")} focusFirst={at.keyboard} onClose={close}>
          {MODE_MENU.map((entry, i) =>
            entry === "-" ? (
              <div key={`-${i}`} role="separator" />
            ) : typeof entry === "string" ? (
              choice(entry)
            ) : (
              <SubMenu
                key={entry.submenu}
                label={t(`mode.${entry.submenu}Menu`)}
                checked={entry.modes.some((m) => m === value)}
              >
                {entry.modes.map((m) => choice(m))}
              </SubMenu>
            ),
          )}
        </Menu>
      )}
    </>
  );
}

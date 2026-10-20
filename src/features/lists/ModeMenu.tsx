import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "../menu/Menu";
import { MenuChoice } from "../menu/MenuChoice";
import { SubMenu } from "../menu/SubMenu";
import { useMenuButton } from "../menu/useMenuButton";
import { MODE_MENU, type Mode } from "./modes";

interface Props {
  value: Mode;
  onChange: (mode: Mode) => void;
}

/** The toolbar button that picks what the table shows, and its menu. */
export function ModeMenu({ value, onChange }: Props) {
  const { t } = useT();
  const { at, close, buttonProps } = useMenuButton();
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
      <button className="mode with-icon" title={t("mode.label")} {...buttonProps}>
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

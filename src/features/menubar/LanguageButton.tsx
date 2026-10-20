import { isolate, languageName } from "../../i18n";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "../menu/Menu";
import { useMenuButton } from "../menu/useMenuButton";
import { LanguageChoices } from "./LanguageChoices";
import { languageCode } from "./languageCode";

/** The menu bar's last button: a globe and the code of the current language; opens the list. */
export function LanguageButton() {
  const { t, lang } = useT();
  const { at, close, buttonProps } = useMenuButton();
  const label = `${t("menubar.language")}: ${isolate(languageName(lang), lang)}`;
  return (
    <>
      <button
        className="language"
        role="menuitem"
        aria-label={label}
        title={label}
        {...buttonProps}
      >
        <Icon name="globe" />
        {languageCode(lang)}
      </button>
      {at && (
        <Menu
          x={at.x}
          y={at.y}
          label={t("menubar.language")}
          focusFirst={at.keyboard}
          scroll
          onClose={close}
        >
          <LanguageChoices />
        </Menu>
      )}
    </>
  );
}

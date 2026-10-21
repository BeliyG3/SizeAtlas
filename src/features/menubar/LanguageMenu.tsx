import { isolate, languageName, type Lang } from "../../i18n";
import { Icon } from "../icons/Icon";
import { LanguageChoices } from "./LanguageChoices";
import { languageCode } from "./languageCode";
import type { BarMenu } from "./MenuBar";

/**
 * The menu bar's last menu: its title is a globe and the code of the current language, and it
 * lists the languages.
 */
export function languageMenu(t: (key: string) => string, lang: Lang): BarMenu {
  return {
    id: "language",
    label: t("menubar.language"),
    face: {
      name: `${t("menubar.language")}: ${isolate(languageName(lang), lang)}`,
      content: (
        <>
          <Icon name="globe" />
          {languageCode(lang)}
        </>
      ),
    },
    items: <LanguageChoices />,
    scroll: true,
  };
}

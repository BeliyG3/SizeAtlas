import { LANGUAGES, isRtl, languageName } from "../../i18n/index";
import { useT } from "../../i18n/react";
import { MenuChoice } from "../menu/MenuChoice";

/** One radio item per language, each in its own name and direction; picking one switches to it. */
export function LanguageChoices() {
  const { lang, setLang } = useT();
  return LANGUAGES.map((l) => (
    <MenuChoice
      key={l.code}
      kind="radio"
      checked={lang === l.code}
      label={languageName(l.code)}
      language={{ lang: l.code, dir: isRtl(l.code) ? "rtl" : "ltr" }}
      onPick={() => setLang(l.code)}
    />
  ));
}

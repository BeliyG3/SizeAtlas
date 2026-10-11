import { LANGUAGES, languageName } from "../../i18n/index";
import { useT } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { THEMES, UNITS } from "../../settings/settings";
import { MenuChoice } from "../menu/MenuChoice";
import { SubMenu } from "../menu/SubMenu";

/** View: size units, the drives panel and the chart, theme and language. */
export function ViewItems() {
  const { t, lang, setLang } = useT();
  const { unit, setUnit, theme, setTheme, showDrives, setShowDrives, showChart, setShowChart } =
    useSettings();
  // "B,KB,MB,GB,…" in the current language; UNITS[i] is units[i - 1] after "auto".
  const units = t("size.units").split(",");
  return (
    <>
      <SubMenu label={t("menubar.units")}>
        {UNITS.map((u, i) => (
          <MenuChoice
            key={u}
            kind="radio"
            checked={unit === u}
            label={u === "auto" ? t("unit.auto") : units[i - 1]}
            onPick={() => setUnit(u)}
          />
        ))}
      </SubMenu>
      <div role="separator" />
      <MenuChoice
        kind="check"
        checked={showDrives}
        label={t("menubar.drives")}
        onPick={() => setShowDrives(!showDrives)}
      />
      <MenuChoice
        kind="check"
        checked={showChart}
        label={t("menubar.chart")}
        onPick={() => setShowChart(!showChart)}
      />
      <div role="separator" />
      <SubMenu label={t("menubar.theme")}>
        {THEMES.map((name) => (
          <MenuChoice
            key={name}
            kind="radio"
            checked={theme === name}
            label={t(`theme.${name}`)}
            onPick={() => setTheme(name)}
          />
        ))}
      </SubMenu>
      <SubMenu label={t("menubar.language")}>
        {LANGUAGES.map((l) => (
          <MenuChoice
            key={l.code}
            kind="radio"
            checked={lang === l.code}
            label={languageName(l.code)}
            onPick={() => setLang(l.code)}
          />
        ))}
      </SubMenu>
    </>
  );
}

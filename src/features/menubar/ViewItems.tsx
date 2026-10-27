import { useT } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { THEMES, UNITS } from "../../settings/settings";
import { MenuChoice } from "../menu/MenuChoice";
import { SubMenu } from "../menu/SubMenu";
import { LanguageChoices } from "./LanguageChoices";

/** View: size units, the drives panel, the chart and the 3D city, theme and language. */
export function ViewItems() {
  const { t } = useT();
  const {
    unit,
    setUnit,
    theme,
    setTheme,
    showDrives,
    setShowDrives,
    showChart,
    setShowChart,
    showCity,
    setShowCity,
  } = useSettings();
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
      <MenuChoice
        kind="check"
        checked={showCity}
        label={t("menubar.city")}
        onPick={() => setShowCity(!showCity)}
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
      <SubMenu label={t("menubar.language")} scroll>
        <LanguageChoices />
      </SubMenu>
    </>
  );
}

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "../../i18n";
import { I18nProvider, useT } from "../../i18n/react";
import { LanguageChoices } from "./LanguageChoices";
import { languageMenu } from "./LanguageMenu";
import { MenuBar } from "./MenuBar";

const inLanguage = (browser: string, ui: React.ReactElement) => {
  vi.stubGlobal("navigator", { languages: [browser] });
  return renderToStaticMarkup(<I18nProvider>{ui}</I18nProvider>);
};

function LanguageBar() {
  const { t, lang } = useT();
  return <MenuBar label="bar" menus={[languageMenu(t, lang)]} />;
}

describe("languageMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a globe and the code, and names the language for assistive technology", () => {
    const html = inLanguage("de", <LanguageBar />);
    expect(html).toMatch(/<\/svg>DE<\/button>/);
    expect(html).toContain('aria-label="Sprache: Deutsch"');
    expect(html).toContain('title="Sprache: Deutsch"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    // Reachable with Tab, unlike the titles with a letter.
    expect(html).not.toContain('tabindex="-1"');
  });

  it("uses the base subtag for a regional language", () => {
    expect(inLanguage("pt-BR", <LanguageBar />)).toMatch(/<\/svg>PT<\/button>/);
  });
});

describe("LanguageChoices", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists every language by its own name, with only the current one checked", () => {
    const html = inLanguage("ar", <LanguageChoices />);
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(LANGUAGES.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"(?:(?!<\/button>).)*<span lang="ar" dir="rtl">/);
    expect(html).toContain('<span lang="he" dir="rtl">');
    expect(html).toContain('<span lang="de" dir="ltr">Deutsch</span>');
  });
});

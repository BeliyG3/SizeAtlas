import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "../../i18n";
import { I18nProvider } from "../../i18n/react";
import { LanguageButton } from "./LanguageButton";
import { LanguageChoices } from "./LanguageChoices";

const inLanguage = (browser: string, ui: React.ReactElement) => {
  vi.stubGlobal("navigator", { languages: [browser] });
  return renderToStaticMarkup(<I18nProvider>{ui}</I18nProvider>);
};

describe("LanguageButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a globe and the code, and names the language for assistive technology", () => {
    const html = inLanguage("de", <LanguageButton />);
    expect(html).toMatch(/<\/svg>DE<\/button>/);
    expect(html).toContain('aria-label="Sprache: Deutsch"');
    expect(html).toContain('title="Sprache: Deutsch"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("uses the base subtag for a regional language", () => {
    expect(inLanguage("pt-BR", <LanguageButton />)).toMatch(/<\/svg>PT<\/button>/);
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

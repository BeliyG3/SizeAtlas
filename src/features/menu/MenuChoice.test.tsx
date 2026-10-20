import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/react";
import { MenuChoice } from "./MenuChoice";

const DRIVE = "C:\\";
const FSI = "\u2068";
const PDI = "\u2069";

const render = (language?: { lang: string; dir: "ltr" | "rtl" }) =>
  renderToStaticMarkup(
    <I18nProvider>
      <MenuChoice
        kind="radio"
        checked={false}
        label="العربية"
        onPick={() => {}}
        language={language}
      />
    </I18nProvider>,
  );

describe("MenuChoice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("wraps a label in another language with its tag and direction", () => {
    expect(render({ lang: "ar", dir: "rtl" })).toContain(
      '<span lang="ar" dir="rtl">العربية</span>',
    );
  });

  it("leaves a label in the interface language bare", () => {
    expect(render()).not.toContain("<span lang");
  });

  it("isolates the tooltip of a path in right-to-left languages only", () => {
    const html = (languages: string[]) => {
      vi.stubGlobal("navigator", { languages });
      return renderToStaticMarkup(
        <I18nProvider>
          <MenuChoice kind="radio" checked={false} label={DRIVE} onPick={() => {}} path />
        </I18nProvider>,
      );
    };
    expect(html(["ar"])).toContain(`title="${FSI}${DRIVE}${PDI}"`);
    expect(html(["en"])).toContain(`title="${DRIVE}"`);
  });
});

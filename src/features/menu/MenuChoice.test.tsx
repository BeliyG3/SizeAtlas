import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuChoice } from "./MenuChoice";

const render = (language?: { lang: string; dir: "ltr" | "rtl" }) =>
  renderToStaticMarkup(
    <MenuChoice
      kind="radio"
      checked={false}
      label="العربية"
      onPick={() => {}}
      language={language}
    />,
  );

describe("MenuChoice", () => {
  it("wraps a label in another language with its tag and direction", () => {
    expect(render({ lang: "ar", dir: "rtl" })).toContain(
      '<span lang="ar" dir="rtl">العربية</span>',
    );
  });

  it("leaves a label in the interface language bare", () => {
    expect(render()).not.toContain("<span lang");
  });
});

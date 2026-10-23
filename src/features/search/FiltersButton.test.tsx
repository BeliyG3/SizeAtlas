import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/react";
import { FiltersButton } from "./FiltersButton";

describe("FiltersButton", () => {
  it("starts closed, as a button that opens a dialog", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <FiltersButton value="photo >1GB" onChange={() => {}} />
      </I18nProvider>,
    );
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("filters-popover");
  });
});

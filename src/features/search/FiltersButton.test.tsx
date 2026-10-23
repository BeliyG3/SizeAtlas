import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/react";
import { FiltersButton, focusLeft, holdsFocus } from "./FiltersButton";

describe("FiltersButton", () => {
  it("starts closed, as a button that opens a dialog", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <FiltersButton value="photo >1GB" onChange={() => {}} />
      </I18nProvider>,
    );
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"/);
    expect(html).toContain('aria-expanded="false"');
    // It points at the dialog only while there is one.
    expect(html).not.toContain("aria-controls");
    expect(html).toContain("<svg");
    expect(html).not.toContain("filters-popover");
  });
});

const box = (inside: object[]) => ({ contains: (n: unknown) => inside.includes(n as object) });

describe("focusLeft", () => {
  const inner = {};
  const outer = {};
  it("is true when the focus went to an element outside the box", () => {
    expect(focusLeft(outer as EventTarget, box([inner]))).toBe(true);
  });

  it("is false inside the box, and for the window or the page (no element)", () => {
    expect(focusLeft(inner as EventTarget, box([inner]))).toBe(false);
    expect(focusLeft(null, box([inner]))).toBe(false);
    expect(focusLeft(outer as EventTarget, null)).toBe(false);
  });
});

describe("holdsFocus", () => {
  const body = {} as Element;
  const inner = {} as Element;
  const other = {} as Element;
  it("hands the focus back when it is in the box or nowhere", () => {
    expect(holdsFocus(inner, body, box([inner]))).toBe(true);
    expect(holdsFocus(body, body, box([inner]))).toBe(true);
    expect(holdsFocus(null, body, null)).toBe(true);
  });

  it("leaves it on another control that was pressed", () => {
    expect(holdsFocus(other, body, box([inner]))).toBe(false);
  });
});

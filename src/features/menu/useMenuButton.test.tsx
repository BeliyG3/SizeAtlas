import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/react";
import { menuBelow, useMenuButton } from "./useMenuButton";

const box = { left: 10, right: 110, bottom: 40 };

describe("menuBelow", () => {
  it("opens from the left edge, below the button", () => {
    expect(menuBelow(box, false, false)).toEqual({ x: 10, y: 40, keyboard: false });
  });

  it("opens from the right edge in right-to-left layouts, and tells the keyboard", () => {
    expect(menuBelow(box, true, true)).toEqual({ x: 110, y: 40, keyboard: true });
  });
});

describe("useMenuButton", () => {
  it("starts closed, with the menu button attributes", () => {
    let seen: ReturnType<typeof useMenuButton> | undefined;
    function Probe() {
      seen = useMenuButton();
      return null;
    }
    renderToStaticMarkup(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(seen?.at).toBeNull();
    expect(seen?.buttonProps["aria-haspopup"]).toBe("menu");
    expect(seen?.buttonProps["aria-expanded"]).toBe(false);
  });
});

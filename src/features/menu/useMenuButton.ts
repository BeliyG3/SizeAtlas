import { useCallback, useState, type MouseEvent, type PointerEvent } from "react";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { anchorX } from "./place";

/** Where a menu opens (see `Menu`) and whether the keyboard opened it. */
export interface MenuAt {
  x: number;
  y: number;
  keyboard: boolean;
}

/** Opens below the button, from its inline-start edge. */
export const menuBelow = (
  box: Pick<DOMRect, "left" | "right" | "bottom">,
  rtl: boolean,
  keyboard: boolean,
): MenuAt => ({ x: anchorX(box, rtl), y: box.bottom, keyboard });

/**
 * State and button props for a toolbar button that opens a `Menu` below it. Render the menu
 * when `at` is set, with `focusFirst={at.keyboard}` and `onClose={close}`.
 */
export function useMenuButton() {
  const { lang } = useT();
  const [at, setAt] = useState<MenuAt | null>(null);
  const close = useCallback(() => setAt(null), []);
  const show = (el: HTMLElement, keyboard: boolean) =>
    setAt(menuBelow(el.getBoundingClientRect(), isRtl(lang), keyboard));
  const buttonProps = {
    "aria-haspopup": "menu" as const,
    "aria-expanded": at !== null,
    // Opens on press, as a menu bar does. A press while it is open closes it: the menu
    // closes itself on that press, before this handler runs with the old state.
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button === 0 && at === null) show(e.currentTarget, false);
    },
    // The press must not take the focus from the menu it opened: its keys would stop working.
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
    // Enter and Space; a pointer click was handled on press.
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.detail === 0) show(e.currentTarget, true);
    },
  };
  return { at, close, buttonProps };
}

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isRtl, mirrorArrow } from "../../i18n";
import { useT } from "../../i18n/react";
import { EDGE, menuLeft } from "./place";
import "./menu.css";

interface Props {
  /**
   * Where it opens, in viewport coordinates: the inline-start corner, so in right-to-left layouts
   * it opens to the left of `x` (see `anchorX`).
   */
  x: number;
  y: number;
  label?: string;
  /**
   * Opened with the keyboard: the first item gets the focus. Else the menu itself does, so the
   * arrow keys still move through it.
   */
  focusFirst?: boolean;
  /** A submenu (see SubMenu): rendered inside its parent menu; ← (→ right-to-left) closes it. */
  nested?: boolean;
  /**
   * Picking an item that does not open a submenu, Escape, Tab, pressing anywhere else, losing
   * the window focus or resizing the window closes the menu.
   */
  onClose: () => void;
  /** Buttons with a menuitem role; `<div role="separator" />` between groups. */
  children: ReactNode;
}

/** Keys that open a context menu from the keyboard. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
  e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/** The open menus that are not submenus: `onClose` → close and give the focus back now. */
const openMenus = new Map<() => void, () => void>();

/**
 * Closes every open menu but the one with `keep` as its `onClose` (Alt on the menu bar): one
 * menu on screen at a time. The focus goes back at once, where each menu took it from.
 */
export function closeMenus(keep?: () => void): void {
  for (const [onClose, dismiss] of openMenus) if (onClose !== keep) dismiss();
}

/** Items of the menu `el`, without those of a submenu open inside it. */
const ownItems = (el: HTMLElement | null): HTMLElement[] =>
  [...(el?.querySelectorAll<HTMLElement>(ITEMS) ?? [])].filter(
    (item) => item.closest('[role="menu"]') === el,
  );

/**
 * A menu rendered over everything, kept inside the window. Keys: arrows, Enter, Escape. An item
 * picked in a submenu closes the menus around it too: its click bubbles through them.
 */
export function Menu({ x, y, label, focusFirst = true, nested = false, onClose, children }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const rtl = isRtl(useT().lang);
  // Where the focus goes back on close, and where if the menu removed that element (a hidden
  // column's header): the focusable container that held it.
  const back = useRef<{ previous: HTMLElement | null; home: HTMLElement | null | undefined }>({
    previous: null,
    home: null,
  });

  // Keep the menu inside the window and move the focus into it; give the focus back on close.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    // StrictMode runs this effect twice on a menu that stays: the second time the focus is
    // already inside the menu, and that item is not where the focus came from.
    if (!el.contains(document.activeElement)) {
      const previous =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      back.current = {
        previous,
        home: previous?.parentElement?.closest<HTMLElement>("[tabindex]"),
      };
    }
    const target = back.current;
    const top = Math.min(y, window.innerHeight - el.offsetHeight - EDGE);
    el.style.left = `${menuLeft(x, el.offsetWidth, window.innerWidth, rtl)}px`;
    el.style.top = `${Math.max(EDGE, top)}px`;
    ((focusFirst && ownItems(el)[0]) || el).focus();
    return () => {
      // Closed by clicking another control: leave the focus there.
      const active = document.activeElement;
      if (active && active !== document.body && !el.contains(active)) return;
      // After the commit that closes the menu, when the DOM shows whether `previous` survived.
      // StrictMode re-runs this effect on a menu that stays: then there is nothing to give back.
      queueMicrotask(() => {
        if (!el.isConnected)
          (target.previous?.isConnected ? target.previous : target.home)?.focus();
      });
    };
  }, [x, y, focusFirst, rtl]);

  useEffect(() => {
    const close = () => onClose();
    // Pressing anywhere else closes it before anything there runs, even where clicks do not
    // bubble (column borders) or another menu opens (a right-click): one menu at a time.
    const press = (e: PointerEvent) => {
      if (!(e.target instanceof Node && menu.current?.contains(e.target))) onClose();
    };
    // Called outside React: the focus is back before the menu is gone, so it stays there.
    const dismiss = () => {
      const { previous, home } = back.current;
      (previous?.isConnected ? previous : home)?.focus();
      onClose();
    };
    if (!nested) openMenus.set(onClose, dismiss);
    window.addEventListener("pointerdown", press, true);
    for (const name of ["blur", "resize"]) window.addEventListener(name, close);
    return () => {
      openMenus.delete(onClose);
      window.removeEventListener("pointerdown", press, true);
      for (const name of ["blur", "resize"]) window.removeEventListener(name, close);
    };
  }, [onClose, nested]);

  const onKey = (e: KeyboardEvent) => {
    const items = ownItems(menu.current);
    const at = items.findIndex((b) => b === document.activeElement);
    const back = nested && mirrorArrow(e.key, rtl) === "ArrowLeft";
    if (e.key === "Escape" || e.key === "Tab" || back) onClose();
    else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(at <= 0 ? items.length : at) - 1]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Runs after the item's own handler.
  const onClick = (e: MouseEvent) => {
    const item = e.target instanceof Element ? e.target.closest(ITEMS) : null;
    if (item && !item.hasAttribute("aria-haspopup")) onClose();
  };

  const box = (
    <div
      className="menu"
      role="menu"
      aria-label={label}
      ref={menu}
      tabIndex={-1}
      onKeyDown={onKey}
      onClick={onClick}
      // Shift+F10 and the menu key also fire `contextmenu` at the focused item: no second menu.
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
  return nested ? box : createPortal(box, document.body);
}

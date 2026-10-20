import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { isRtl, mirrorArrow } from "../../i18n";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { Menu } from "./Menu";

interface Props {
  label: string;
  /** Marks the item when the current choice is inside. */
  checked?: boolean;
  /** Shown in place of the check mark, as on the items of a command menu. */
  icon?: IconName;
  /** Items of the submenu. */
  children: ReactNode;
}

/** Lines the first item of the submenu up with this one (the menu's padding and border). */
const ALIGN = 5;

/**
 * A menu item that opens a nested menu on hover, click, Enter, Space or → (← right-to-left), on
 * its inline-end side. Leaving it with the pointer, ← (→) or Escape closes the nested menu, and
 * so does the focus moving elsewhere (another submenu opened by pointing at it): one nested menu
 * at a time, whatever opened it.
 */
export function SubMenu({ label, checked = false, icon, children }: Props) {
  const [open, setOpen] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
  const item = useRef<HTMLButtonElement>(null);
  const rtl = isRtl(useT().lang);
  const close = useCallback(() => setOpen(null), []);
  const show = (keyboard: boolean) => {
    const box = item.current?.getBoundingClientRect();
    if (box) setOpen({ x: rtl ? box.left : box.right, y: box.top - ALIGN, keyboard });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (mirrorArrow(e.key, rtl) !== "ArrowRight" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    show(true);
  };
  return (
    // The nested menu is inside this box: moving the pointer into it does not leave the box.
    <div
      className="submenu"
      onPointerLeave={close}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
          close();
      }}
    >
      <button
        ref={item}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onPointerEnter={() => {
          if (open !== null) return;
          // The nested menu gives the focus back to this item when it closes (Escape, ←).
          item.current?.focus();
          show(false);
        }}
        onClick={() => open === null && show(false)}
        onKeyDown={onKeyDown}
      >
        {icon ? (
          <Icon name={icon} />
        ) : (
          <span className="check" aria-hidden="true">
            {checked ? "●" : ""}
          </span>
        )}
        {label}
        <span className="arrow icon-dir" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <Menu x={open.x} y={open.y} label={label} focusFirst={open.keyboard} nested onClose={close}>
          {children}
        </Menu>
      )}
    </div>
  );
}

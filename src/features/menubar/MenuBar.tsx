import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Menu, closeMenus } from "../menu/Menu";
import { loneAlt } from "./altKey";
import { mnemonic, mnemonicHit } from "./mnemonic";
import "./menubar.css";

export interface BarMenu {
  id: string;
  /** Title with "&" before the letter that opens it with Alt (see `mnemonic`). */
  label: string;
  /** Items of the menu (see Menu). */
  items: ReactNode;
}

interface Props {
  label: string;
  menus: readonly BarMenu[];
}

interface Opened {
  id: string;
  x: number;
  y: number;
  /** Opened with the keyboard: the first item gets the focus. */
  keyboard: boolean;
}

/**
 * The window's menu bar. A press opens a menu and a press on its title closes it; while one is
 * open, pointing at another title opens that one. Alt alone moves the focus to the bar and back,
 * Alt and the underlined letter open a menu. ← and → go to the next menu, also while one is open;
 * ↓, Enter and Space open the focused one; Escape closes the menu, then leaves the bar.
 */
export function MenuBar({ label, menus }: Props) {
  const [open, setOpen] = useState<Opened | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // Where the focus was before the bar took it: it goes back there when the bar is left.
  const returnTo = useRef<Element | null>(null);

  const title = (id: string) =>
    bar.current?.querySelector<HTMLElement>(`[data-menu="${id}"]`) ?? null;
  // Stable: the open menu's listeners call it.
  const leave = useCallback(() => {
    setOpen(null);
    const back = returnTo.current;
    returnTo.current = null;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus();
  }, []);
  const enter = () => {
    // Another open menu (a context menu) closes first and gives the focus back: one menu at a time.
    closeMenus(leave);
    const active = document.activeElement;
    if (!bar.current?.contains(active)) returnTo.current = active;
  };
  const show = (id: string, keyboard: boolean) => {
    const box = title(id)?.getBoundingClientRect();
    if (box) setOpen({ id, x: box.left, y: box.bottom, keyboard });
  };
  const neighbour = (id: string, step: number) => {
    const at = menus.findIndex((m) => m.id === id);
    return menus[(at + step + menus.length) % menus.length].id;
  };

  // Called by the window listeners below, which are added once.
  const openKey = (key: string, code: string) => {
    const menu = menus.find((m) => mnemonicHit(m.label, key, code));
    if (!menu) return false;
    enter();
    show(menu.id, true);
    return true;
  };
  const toggle = () => {
    if (open || bar.current?.contains(document.activeElement)) leave();
    else {
      enter();
      if (menus.length > 0) title(menus[0].id)?.focus();
    }
  };
  const latest = useRef({ openKey, toggle });
  useLayoutEffect(() => {
    latest.current = { openKey, toggle };
  });
  useEffect(() => {
    // Alt pressed alone and released with no other key in between (see loneAlt).
    let alone = false;
    const down = (e: globalThis.KeyboardEvent) => {
      // A modal dialog is open: the bar behind it stays out of reach.
      if (document.querySelector("dialog[open]")) {
        alone = false;
        return;
      }
      alone = loneAlt(alone, e);
      if (e.key === "Alt") return;
      const plain = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat;
      if (plain && latest.current.openKey(e.key, e.code)) e.preventDefault();
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Alt") {
        alone = loneAlt(alone, e);
        return;
      }
      if (alone) {
        e.preventDefault();
        latest.current.toggle();
      }
      alone = false;
    };
    const reset = () => {
      alone = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);

  // Keys on a focused title, and keys the open menu leaves to the bar (it is a React child).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Alt+← and Alt+→ go back and forward through the folders.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const focused = e.target instanceof HTMLElement ? e.target.dataset.menu : undefined;
    const current = open?.id ?? focused;
    if (current === undefined) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const next = neighbour(current, e.key === "ArrowLeft" ? -1 : 1);
      if (open) show(next, true);
      else title(next)?.focus();
    } else if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      show(current, true);
    } else if (!open && e.key === "Escape") leave();
    else return;
    e.preventDefault();
  };
  // Escape in an open menu (not in a submenu, which closes itself) goes back to its title.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !open) return;
    if (e.target instanceof Element && e.target.closest(".submenu .menu")) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(null);
    title(open.id)?.focus();
  };

  const shown = open && menus.find((m) => m.id === open.id);
  return (
    <div
      className="menubar"
      role="menubar"
      aria-label={label}
      ref={bar}
      onKeyDown={onKeyDown}
      onKeyDownCapture={onKeyDownCapture}
    >
      {menus.map((m) => {
        const { text, at } = mnemonic(m.label);
        return (
          <button
            key={m.id}
            data-menu={m.id}
            role="menuitem"
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={open?.id === m.id}
            // A press does not move the focus to the title: the menu it opens takes it.
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              // The open menu has closed itself on this press already.
              if (open?.id === m.id) leave();
              else {
                enter();
                show(m.id, false);
              }
            }}
            onPointerEnter={() => {
              if (open && open.id !== m.id) show(m.id, false);
            }}
            // Enter and Space; a pointer press was handled on press.
            onClick={(e) => {
              if (e.detail !== 0) return;
              enter();
              show(m.id, true);
            }}
          >
            {at < 0 ? (
              text
            ) : (
              <>
                {text.slice(0, at)}
                <u>{text.charAt(at)}</u>
                {text.slice(at + 1)}
              </>
            )}
          </button>
        );
      })}
      {open && shown && (
        <Menu
          x={open.x}
          y={open.y}
          label={mnemonic(shown.label).text}
          focusFirst={open.keyboard}
          onClose={leave}
        >
          {shown.items}
        </Menu>
      )}
    </div>
  );
}

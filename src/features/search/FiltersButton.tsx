import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { EDGE, menuLeft } from "../menu/place";
import { menuBelow, type MenuAt } from "../menu/useMenuButton";
import { DEFAULT_UNITS, FiltersPanel, type Drafts, type Units } from "./FiltersPanel";

interface Props {
  /** The search text and its setter: the panel reads the conditions from it and writes them to it. */
  value: string;
  onChange: (value: string) => void;
}

/** Whether the focus went from the box to another element (to null: to the window or the page itself). */
export const focusLeft = (next: EventTarget | null, box: Pick<Node, "contains"> | null) =>
  next !== null && box !== null && !box.contains(next as Node);

/** Whether the focus is in the box or nowhere: then closing it hands the focus back to the button. */
export const holdsFocus = (
  active: Element | null,
  body: Element,
  box: Pick<Node, "contains"> | null,
) => active === null || active === body || (box?.contains(active) ?? false);

/** The Filters button of the search field; it opens the panel below it. */
export function FiltersButton({ value, onChange }: Props) {
  const { t, lang } = useT();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<MenuAt | null>(null);
  // What the panel remembers while it is open: units of numbers that are not set, text typed in a
  // box that is no condition, and that a change did not fit.
  const [units, setUnits] = useState<Units>(DEFAULT_UNITS);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [tooLong, setTooLong] = useState(false);
  // Every way of closing: the focus goes back to the button unless it already went to another control.
  const close = useCallback(() => {
    if (holdsFocus(document.activeElement, document.body, document.getElementById(id)))
      button.current?.focus();
    setAt(null);
    setDrafts({});
    setTooLong(false);
  }, [id]);
  return (
    <>
      <button
        ref={button}
        className="filters-button"
        title={t("filters.button")}
        aria-label={t("filters.button")}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        aria-controls={at !== null ? id : undefined}
        onClick={(e) =>
          at === null
            ? setAt(menuBelow(e.currentTarget.getBoundingClientRect(), isRtl(lang), false))
            : close()
        }
      >
        <Icon name="filter" />
      </button>
      {at && (
        <Popover id={id} at={at} button={button} onClose={close}>
          <FiltersPanel
            text={value}
            onText={onChange}
            units={units}
            onUnit={(field, unit) => setUnits((now) => ({ ...now, [field]: unit }))}
            drafts={drafts}
            onDraft={(field, raw) => setDrafts((now) => ({ ...now, [field]: raw }))}
            tooLong={tooLong}
            onTooLong={setTooLong}
            onClose={close}
          />
        </Popover>
      )}
    </>
  );
}

interface PopoverProps {
  id: string;
  at: MenuAt;
  /** Pressing it is the button's business (it closes the panel), not an outside press. */
  button: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A box over everything, kept inside the window. Like a menu it closes when the window is resized,
 * loses the focus or is pressed elsewhere; and, being a form, when the focus moves to another
 * element (Tab out of it).
 */
function Popover({ id, at, button, onClose, children }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const { t, lang } = useT();
  const rtl = isRtl(lang);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const top = Math.min(at.y, window.innerHeight - el.offsetHeight - EDGE);
    el.style.left = `${menuLeft(at.x, el.offsetWidth, window.innerWidth, rtl)}px`;
    el.style.top = `${Math.max(EDGE, top)}px`;
    el.querySelector<HTMLElement>("input, select")?.focus();
  }, [at, rtl]);

  useEffect(() => {
    const press = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (!box.current?.contains(target) && !button.current?.contains(target)) onClose();
    };
    // A unit list that is open takes the window focus on some platforms: not a reason to close.
    const blur = () => {
      const active = document.activeElement;
      if (active instanceof HTMLSelectElement && box.current?.contains(active)) return;
      onClose();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", onClose);
    };
  }, [button, onClose]);

  return createPortal(
    <div
      id={id}
      className="filters-popover"
      role="dialog"
      aria-label={t("filters.button")}
      ref={box}
      // A press on bare panel keeps the focus in the panel (so Esc still works).
      tabIndex={-1}
      // Esc on the bare panel (the controls handle their own and stop it there).
      onKeyDown={(e) => closeOnEscape(e, onClose)}
      onBlur={(e) =>
        // Onto the button is its press (it closes the panel itself), not Tab out of the panel.
        e.relatedTarget !== button.current && focusLeft(e.relatedTarget, box.current) && onClose()
      }
    >
      {children}
    </div>,
    document.body,
  );
}

/** Closes on Escape and keeps the key from reaching anything behind the panel. */
export function closeOnEscape(
  e: { key: string; preventDefault: () => void; stopPropagation: () => void },
  close: () => void,
) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

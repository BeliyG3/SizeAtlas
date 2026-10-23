import {
  useCallback,
  useEffect,
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
import { DEFAULT_UNITS, FiltersPanel, type Units } from "./FiltersPanel";

interface Props {
  /** The search text and its setter: the panel reads the conditions from it and writes them to it. */
  value: string;
  onChange: (value: string) => void;
}

/** The Filters button of the search field; it opens the panel below it. */
export function FiltersButton({ value, onChange }: Props) {
  const { t, lang } = useT();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<MenuAt | null>(null);
  const [units, setUnits] = useState<Units>(DEFAULT_UNITS);
  const close = useCallback(() => setAt(null), []);
  return (
    <>
      <button
        ref={button}
        className="filters-button"
        title={t("filters.button")}
        aria-label={t("filters.button")}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        onClick={(e) =>
          setAt(
            at === null
              ? menuBelow(e.currentTarget.getBoundingClientRect(), isRtl(lang), false)
              : null,
          )
        }
      >
        <Icon name="filter" />
      </button>
      {at && (
        <Popover at={at} button={button} onClose={close}>
          <FiltersPanel
            text={value}
            onText={onChange}
            units={units}
            onUnit={(field, unit) => setUnits((now) => ({ ...now, [field]: unit }))}
            onClose={() => {
              close();
              button.current?.focus();
            }}
          />
        </Popover>
      )}
    </>
  );
}

interface PopoverProps {
  at: MenuAt;
  /** Pressing it is the button's business (it closes the panel), not an outside press. */
  button: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** A box over everything, kept inside the window, closed by pressing elsewhere or resizing. */
function Popover({ at, button, onClose, children }: PopoverProps) {
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
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("resize", onClose);
    };
  }, [button, onClose]);

  return createPortal(
    <div className="filters-popover" role="dialog" aria-label={t("filters.button")} ref={box}>
      {children}
    </div>,
    document.body,
  );
}

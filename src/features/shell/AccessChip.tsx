import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCount } from "../../format";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { closeOnEscape, focusLeft, holdsFocus } from "../search/FiltersButton";
import { AccessInfo, type AccessProps } from "./AccessInfo";

/** The gap between the chip and the popover above it, in px. */
const GAP = 4;

/** Where the popover sits: above the chip, its inline-end edge on the chip's. */
interface At {
  bottom: number;
  end: number;
}

/**
 * "⚠ 184" in the status bar: the unreadable folders, always there once a scan has any. It opens a
 * popover with the text and the buttons of the banner.
 */
export function AccessChip(props: AccessProps) {
  const { t, lang } = useT();
  const id = useId();
  const rtl = isRtl(lang);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<At | null>(null);
  const label = t("banner.chip");

  const close = useCallback(() => {
    // Focus goes back to the chip unless it already went to another control.
    if (holdsFocus(document.activeElement, document.body, box.current)) button.current?.focus();
    setAt(null);
  }, []);
  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      bottom: window.innerHeight - rect.top + GAP,
      end: rtl ? rect.left : window.innerWidth - rect.right,
    });
  };

  useLayoutEffect(() => {
    if (at) box.current?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const press = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (!box.current?.contains(target) && !button.current?.contains(target)) close();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [at, close]);

  const count = formatCount(props.count, lang);
  return (
    <>
      <button
        ref={button}
        className="access-chip"
        title={label}
        aria-label={`${label}: ${count}`}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        aria-controls={at !== null ? id : undefined}
        onClick={() => (at === null ? open() : close())}
        onKeyDown={(e) => at !== null && closeOnEscape(e, close)}
      >
        <span aria-hidden="true">⚠</span> {count}
      </button>
      {at &&
        createPortal(
          <div
            id={id}
            ref={box}
            className="access-popover"
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            style={{ bottom: at.bottom, insetInlineEnd: at.end }}
            onKeyDown={(e) => closeOnEscape(e, close)}
            // Tab out of the popover closes it, as in the filters panel.
            onBlur={(e) =>
              e.relatedTarget !== button.current &&
              focusLeft(e.relatedTarget, box.current) &&
              close()
            }
          >
            <AccessInfo
              {...props}
              onShow={() => {
                props.onShow();
                close();
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

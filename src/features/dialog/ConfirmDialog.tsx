import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n/react";
import "./dialog.css";

export interface DialogAction {
  label: string;
  run: () => void;
}

interface Props {
  /** Line breaks start new lines; may hold a link. */
  message: ReactNode;
  /**
   * Left to right, before Cancel. The first is the main one: it has the focus (unless
   * `focusCancel`), Enter presses it.
   */
  actions: readonly DialogAction[];
  /** The focus starts on Cancel: for a question whose main action is hard to take back. */
  focusCancel?: boolean;
  /** Label of the last button, which only closes the dialog (default: Cancel). */
  cancelLabel?: string;
  /** Any button or Escape closes the dialog. */
  onClose: () => void;
  /** An image at the left of the message, such as the app icon. */
  icon?: string;
}

/**
 * A modal question inside the window: the rest of the window is inert while it is open, Escape
 * cancels, and the focus goes back where it was when it closes.
 */
export function ConfirmDialog({
  message,
  actions,
  cancelLabel,
  focusCancel,
  onClose,
  icon,
}: Props) {
  const { t } = useT();
  const id = useId();
  const box = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // Where the focus was before the dialog took it; read once, before the dialog is shown.
  const [previous] = useState(() => document.activeElement);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // A modal dialog focuses its first button, the main one. StrictMode re-runs this on an
    // open dialog. Removing the dialog from the page ends it: no close() on the way out.
    if (!el.open) el.showModal();
    if (focusCancel) cancel.current?.focus();
    return () => {
      // After the commit that removes the dialog; StrictMode re-runs this on a dialog that stays.
      queueMicrotask(() => {
        if (!el.isConnected && previous instanceof HTMLElement && previous.isConnected)
          previous.focus();
      });
    };
  }, [previous, focusCancel]);

  const press = (run?: () => void) => {
    run?.();
    onClose();
  };
  return (
    <dialog
      className="confirm"
      ref={box}
      aria-labelledby={id}
      // Escape: the browser closes the dialog (it may not let a page refuse that).
      onClose={onClose}
    >
      <div className="body">
        {icon && <img className="icon" src={icon} width={64} height={64} alt="" />}
        <p id={id}>{message}</p>
      </div>
      <div className="actions">
        {actions.map((a, i) => (
          <button
            key={a.label}
            className={i === 0 ? "primary" : undefined}
            onClick={() => press(a.run)}
          >
            {a.label}
          </button>
        ))}
        <button ref={cancel} onClick={() => press()}>
          {cancelLabel ?? t("dialog.cancel")}
        </button>
      </div>
    </dialog>
  );
}

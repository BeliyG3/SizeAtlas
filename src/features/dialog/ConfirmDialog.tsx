import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n/react";
import "./dialog.css";

export interface DialogAction {
  label: string;
  run: () => void;
  /** It cannot be taken back: the button is red (its label says so too). */
  danger?: boolean;
  /** The dialog stays open: `run` puts the next question in it. */
  keepOpen?: boolean;
  /** Not yet: the button is disabled, and a press does nothing (the dialog stays open). */
  disabled?: boolean;
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
  /**
   * Which question the dialog asks, for a dialog that asks several in turn: at each new one the
   * focus goes back to Cancel (with `focusCancel`).
   */
  question?: number;
  /** A key held down (Enter, Space) presses no button: it may still be down from the question before. */
  ignoreHeldKeys?: boolean;
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
  question,
  ignoreHeldKeys,
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
    return () => {
      // After the commit that removes the dialog; StrictMode re-runs this on a dialog that stays.
      queueMicrotask(() => {
        if (!el.isConnected && previous instanceof HTMLElement && previous.isConnected)
          previous.focus();
      });
    };
  }, [previous]);
  // After `showModal`, which focused the main button; again for each new question.
  useLayoutEffect(() => {
    if (focusCancel) cancel.current?.focus();
  }, [focusCancel, question]);

  const press = (action?: DialogAction) => {
    if (action?.disabled) return;
    action?.run();
    if (!action?.keepOpen) onClose();
  };
  return (
    <dialog
      className="confirm"
      ref={box}
      aria-labelledby={id}
      // Escape: the browser closes the dialog (it may not let a page refuse that).
      onClose={onClose}
      // A held key repeats: only its first press, made for this question, may answer it.
      onKeyDown={
        ignoreHeldKeys
          ? (e) => {
              if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
            }
          : undefined
      }
    >
      <div className="body">
        {icon && <img className="icon" src={icon} width={64} height={64} alt="" />}
        <p id={id}>{message}</p>
      </div>
      <div className="actions">
        {actions.map((a, i) => (
          <button
            key={a.label}
            className={a.danger ? "danger" : i === 0 ? "primary" : undefined}
            disabled={a.disabled}
            onClick={() => press(a)}
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

import { useCallback, useState } from "react";
import { isCmdError } from "../../api/client";
import { useT } from "../../i18n/react";

interface Toast {
  id: number;
  text: string;
}

let nextId = 1;
const TOAST_MS = 6000;

/** Keeps a short list of messages; each disappears after a few seconds. */
export function useToasts() {
  const { t } = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string) => {
    const id = nextId++;
    setToasts((list) => [...list, { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), TOAST_MS);
  }, []);
  /** The message of a failed request. */
  const errorText = useCallback(
    (e: unknown) => (isCmdError(e) ? t(`error.${e.code}`, { ...e }) : String(e)),
    [t],
  );
  const pushError = useCallback((e: unknown) => push(errorText(e)), [push, errorText]);
  return { toasts, push, pushError, errorText };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast">
          {x.text}
        </div>
      ))}
    </div>
  );
}

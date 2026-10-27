import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DupGroup } from "../../../api/duplicates";
import { formatCount } from "../../../format";
import { useT } from "../../../i18n/react";
import { ItemIcon } from "../../contents/ItemIcon";
import type { Picture } from "./useImageUrl";
import { ZoomView, type ZoomHandle } from "./ZoomView";
import "./viewer.css";

interface Props {
  group: DupGroup;
  picture: Picture;
  /** "N of M" among the groups whose name is a picture type. */
  position: number;
  total: number;
  /** ← / →: the previous or next group with a picture type. */
  onStep: (dir: -1 | 1) => void;
  onClose: () => void;
}

/**
 * The picture of a group over the whole window: a native modal dialog, so the window under it is
 * inert and its shortcuts wait (`dialog[open]`); Escape, Close or a click on the dark background
 * closes it, and the focus goes back where it was.
 */
export function Lightbox({ group, picture, position, total, onStep, onClose }: Props) {
  const { t, lang } = useT();
  const box = useRef<HTMLDialogElement>(null);
  const zoom = useRef<ZoomHandle>(null);
  // Where the focus was before the dialog took it; read once, before the dialog is shown.
  const [previous] = useState(() => document.activeElement);
  const [broken, setBroken] = useState<string | null>(null);
  const url = picture.state === "ready" && picture.url !== broken ? picture.url : null;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // As ConfirmDialog: removing the dialog from the page ends it, no close() on the way out.
    if (!el.open) el.showModal();
    return () => {
      queueMicrotask(() => {
        if (!el.isConnected && previous instanceof HTMLElement && previous.isConnected)
          previous.focus();
      });
    };
  }, [previous]);

  // Not mirrored in a right-to-left language: pictures are not text. A plain arrow only: Alt+←
  // and the like belong to the history.
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    onStep(dir);
  };
  return (
    <dialog
      className="lightbox"
      ref={box}
      aria-label={group.name}
      // Escape: the browser closes the dialog.
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      <div className="lightbox-picture">
        {url ? (
          <ZoomView
            ref={zoom}
            url={url}
            label={group.name}
            onBackground={onClose}
            onError={() => setBroken(url)}
          />
        ) : (
          <div
            className="lightbox-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            <ItemIcon isDir={false} category={group.category} />
            <span dir="auto">{group.name}</span>
          </div>
        )}
      </div>
      <div className="lightbox-bar">
        <span className="lightbox-name" dir="auto">
          {group.name}
        </span>
        <span className="lightbox-position">
          {t("dup.view.position", {
            n: formatCount(position, lang),
            total: formatCount(total, lang),
          })}
        </span>
        {/* Always there, never disabled, even with no picture: the focus may be on one of
            them, and a button that goes takes the focus out of the dialog (and the arrows). */}
        <button type="button" onClick={() => zoom.current?.fit()}>
          {t("dup.view.fit")}
        </button>
        <button type="button" onClick={() => zoom.current?.actual()}>
          {t("dup.view.actual")}
        </button>
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </dialog>
  );
}

import { useCallback, useState } from "react";
import type { Sources } from "../../api/types";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "../menu/Menu";
import { anchorX } from "../menu/place";
import { SourceItems } from "./SourceItems";

interface Props {
  sources: Sources | null;
  /** The source picked in the list. */
  pending: string | null;
  onPick: (path: string) => void;
  /** "Choose folder…" in the list. */
  onChooseFolder: () => void;
}

/** The toolbar field that shows the source and opens the list of drives and recent folders. */
export function SourcePicker({ sources, pending, onPick, onChooseFolder }: Props) {
  const { t, lang } = useT();
  const [at, setAt] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
  const close = useCallback(() => setAt(null), []);
  const show = (el: HTMLElement, keyboard: boolean) => {
    const box = el.getBoundingClientRect();
    setAt({ x: anchorX(box, isRtl(lang)), y: box.bottom, keyboard });
  };
  const text = pending ?? t("toolbar.pickSource");
  return (
    <>
      <button
        className="source with-icon"
        aria-label={t("toolbar.source")}
        title={text}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        // Opens on press, as a menu bar does; ModeMenu explains the three handlers.
        onPointerDown={(e) => {
          if (e.button === 0 && at === null) show(e.currentTarget, false);
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (e.detail === 0) show(e.currentTarget, true);
        }}
      >
        <span className={pending === null ? "text ellipsis dim" : "text ellipsis"}>{text}</span>
        <Icon name="chevron-down" />
      </button>
      {at && (
        <Menu
          x={at.x}
          y={at.y}
          label={t("toolbar.source")}
          focusFirst={at.keyboard}
          scroll
          onClose={close}
        >
          <SourceItems
            sources={sources}
            pending={pending}
            t={t}
            onPick={onPick}
            onChooseFolder={onChooseFolder}
          />
        </Menu>
      )}
    </>
  );
}

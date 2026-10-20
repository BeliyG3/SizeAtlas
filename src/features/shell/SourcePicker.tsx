import type { Sources } from "../../api/types";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import { Menu } from "../menu/Menu";
import { useMenuButton } from "../menu/useMenuButton";
import { SourceItems } from "./SourceItems";
import { sourceLabel } from "./source";

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
  const { t } = useT();
  const { at, close, buttonProps } = useMenuButton();
  const text = pending === null ? t("toolbar.pickSource") : sourceLabel(sources, pending, t);
  return (
    <>
      <button
        className="source with-icon"
        aria-label={t("toolbar.source")}
        title={pending ?? text}
        {...buttonProps}
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

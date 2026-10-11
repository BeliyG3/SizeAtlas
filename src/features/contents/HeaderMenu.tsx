import { useT } from "../../i18n/react";
import { Menu } from "../menu/Menu";
import { isListOnly } from "./layout";
import type { ColumnId } from "./columns";
import type { ColumnLayout } from "./useColumnLayout";

/** The header the menu was opened on, and where (viewport coordinates). */
export interface HeaderMenuTarget {
  id: ColumnId;
  x: number;
  y: number;
}

interface Props {
  target: HeaderMenuTarget;
  layout: ColumnLayout;
  onClose: () => void;
}

/** Context menu of the table header: fit widths, show or hide columns, reset them. */
export function HeaderMenu({ target, layout, onClose }: Props) {
  const { t } = useT();
  const { view } = layout;
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <Menu x={target.x} y={target.y} label={t("columns.menu")} onClose={onClose}>
      <button role="menuitem" onClick={() => run(() => layout.fit(target.id))}>
        {t("columns.fit")}
      </button>
      <button role="menuitem" onClick={() => run(layout.fitAll)}>
        {t("columns.fitAll")}
      </button>
      <div role="separator" />
      {view.order
        .filter((id) => layout.lists || !isListOnly(id))
        .map((id) => {
          const shown = !view.hidden.includes(id);
          return (
            <button
              key={id}
              role="menuitemcheckbox"
              aria-checked={shown}
              // The name is what identifies a row: it is always shown.
              disabled={id === "name"}
              onClick={() => run(() => layout.toggle(id))}
            >
              <span className="check" aria-hidden="true">
                {shown ? "✓" : ""}
              </span>
              {t(`col.${id}`)}
            </button>
          );
        })}
      <div role="separator" />
      <button role="menuitem" onClick={() => run(layout.reset)}>
        {t("columns.reset")}
      </button>
    </Menu>
  );
}

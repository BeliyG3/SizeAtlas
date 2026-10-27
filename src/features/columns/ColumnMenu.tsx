import { useT } from "../../i18n/react";
import { Menu } from "../menu/Menu";
import type { GridColumn, GridLayout } from "./grid";

/** The header the menu was opened on, and where (viewport coordinates). */
export interface ColumnMenuTarget<K extends string> {
  id: K;
  x: number;
  y: number;
}

interface Props<K extends string> {
  target: ColumnMenuTarget<K>;
  layout: GridLayout<K, GridColumn<K>>;
  onClose: () => void;
}

/** Context menu of a table header: fit widths, show or hide columns, reset them. */
export function ColumnMenu<K extends string>({ target, layout, onClose }: Props<K>) {
  const { t } = useT();
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
      {layout.options.map(({ id, shown }) => (
        <button
          key={id}
          role="menuitemcheckbox"
          aria-checked={shown}
          // The pinned column is what identifies a row: it is always shown.
          disabled={id === layout.pinned}
          onClick={() => run(() => layout.toggle(id))}
        >
          <span className="check" aria-hidden="true">
            {shown ? "✓" : ""}
          </span>
          {t(layout.labelKey(id))}
        </button>
      ))}
      <div role="separator" />
      <button role="menuitem" onClick={() => run(layout.reset)}>
        {t("columns.reset")}
      </button>
    </Menu>
  );
}

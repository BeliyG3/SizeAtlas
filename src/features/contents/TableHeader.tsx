import { useCallback, useState, type KeyboardEvent } from "react";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { ColumnDivider } from "../columns/ColumnDivider";
import { DragGhost } from "../columns/DragGhost";
import { useColumnDrag } from "../columns/useColumnDrag";
import { isMenuKey } from "../menu/Menu";
import { anchorX } from "../menu/place";
import type { Column, HeaderSort } from "./columns";
import { HeaderMenu, type HeaderMenuTarget } from "./HeaderMenu";
import type { ColumnLayout } from "./useColumnLayout";

interface Props {
  layout: ColumnLayout;
  /** The column with the arrow; null for none (a flat list in its own order). */
  sort: HeaderSort | null;
  /** Columns whose header sorts. */
  canSort: (column: Column) => boolean;
  /** Tooltip of the size columns: how sizes on disk were measured. */
  sizeHint: string;
  /** A sortable header was clicked. */
  onSort: (column: Column) => void;
}

const ariaSort = (c: Column, sort: HeaderSort | null, sortable: boolean) => {
  if (!sortable) return undefined;
  if (sort?.column !== c.id) return "none";
  return sort.descending ? "descending" : "ascending";
};

/**
 * Sticky header: a click sorts, dragging a cell moves its column, the borders resize, and the
 * context menu fits, shows, hides and resets columns.
 */
export function TableHeader({ layout, sort, canSort, sizeHint, onSort }: Props) {
  const { t, lang } = useT();
  const { columns, widths, template, width } = layout;
  const [menu, setMenu] = useState<HeaderMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Name stays first: it is what identifies a row.
  const drag = useColumnDrag(layout.ids, layout.move, "name");

  // Shift+F10 or the menu key in the header (or in its menu, a React child): this menu, never
  // the one of the cursor row.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isMenuKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const cell = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-col]") : null;
    if (!cell) return;
    const box = cell.getBoundingClientRect();
    setMenu({ id: cell.dataset.col as Column["id"], x: anchorX(box, isRtl(lang)), y: box.bottom });
  };

  return (
    <div
      className="chead"
      role="row"
      aria-rowindex={1}
      style={{ gridTemplateColumns: template, width }}
      onKeyDown={onKeyDown}
    >
      {columns.map((c) => {
        const label = t(`col.${c.id}`);
        const sortable = canSort(c);
        const classes = [c.numeric && "num", drag.dragging === c.id && "col-dragging"];
        return (
          <span
            key={c.id}
            role="columnheader"
            aria-sort={ariaSort(c, sort, sortable)}
            data-col={c.id}
            className={classes.filter(Boolean).join(" ") || undefined}
            title={c.id === "size" || c.id === "percent" ? sizeHint : undefined}
            onPointerDown={(e) => drag.start(c.id, e)}
            onClickCapture={drag.suppressClick}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: c.id, x: e.clientX, y: e.clientY });
            }}
          >
            {sortable ? (
              <button className="col-sort" onClick={() => onSort(c)}>
                <span className="ellipsis">{label}</span>
                {sort?.column === c.id && (
                  <span aria-hidden="true">{sort.descending ? "▼" : "▲"}</span>
                )}
              </button>
            ) : (
              <span className="label ellipsis">{label}</span>
            )}
            <ColumnDivider
              label={t("columns.width", { name: label })}
              width={widths[c.id]}
              onResize={(w, done) => layout.resize(c.id, w, done)}
              onFit={() => layout.fit(c.id)}
            />
          </span>
        );
      })}
      <DragGhost view={drag.view} />
      {menu && <HeaderMenu target={menu} layout={layout} onClose={closeMenu} />}
    </div>
  );
}

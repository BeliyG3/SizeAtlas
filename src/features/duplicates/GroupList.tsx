import { useRef, type ReactNode } from "react";
import type { DupGroup } from "../../api/duplicates";
import { formatCount } from "../../format";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ItemIcon } from "../contents/ItemIcon";
import { ROW_HEIGHT, visibleRange } from "../contents/pages";
import { tableKeyDown, useViewport, type RowActions } from "../contents/tableView";
import { scrollToRow } from "../contents/useCursor";
import "../contents/contents.css";

/** Icon, name, copies, size of a copy, what can be freed. */
const TEMPLATE = "28px minmax(80px, 1fr) 56px 88px 110px";

interface Props {
  /** In the order shown. */
  groups: readonly DupGroup[];
  /** Key of the group whose copies are shown. */
  selected: string | null;
  onPick: (key: string) => void;
}

const nothing = () => {};

/** The groups of the result, one row each; the selected one is the cursor row. Virtual. */
export function GroupList({ groups, selected, onPick }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const body = useRef<HTMLDivElement>(null);
  const { scrollTop, viewport, onScroll } = useViewport(body);
  const { first, last } = visibleRange(scrollTop, viewport, groups.length);
  const at = groups.findIndex((g) => g.key === selected);
  const cursor = at < 0 ? null : at;

  const point = (index: number) => {
    if (groups.length === 0) return;
    const next = Math.max(0, Math.min(groups.length - 1, index));
    if (body.current) scrollToRow(body.current, next);
    onPick(groups[next].key);
  };
  // A group is not an item: no marks, no menu, nothing to open or go up to.
  const actions: RowActions = {
    point,
    markAll: nothing,
    trash: nothing,
    open: nothing,
    menuAt: nothing,
    up: nothing,
  };

  const rows: ReactNode[] = [];
  for (let index = first; index < last; index++) {
    const group = groups[index];
    const state = `${index % 2 ? " alt" : ""}${index === cursor ? " cursor" : ""}`;
    rows.push(
      <div
        key={group.key}
        id={`dgroup-${index}`}
        data-index={index}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={index === cursor}
        className={`crow${state}`}
        style={{ top: index * ROW_HEIGHT, gridTemplateColumns: TEMPLATE }}
        onClick={() => point(index)}
      >
        <span role="gridcell" className="dup-icon">
          <ItemIcon isDir={false} category={group.category} />
        </span>
        <span role="gridcell" dir="auto" title={group.name}>
          {group.name}
        </span>
        <span role="gridcell" className="num">
          ×{formatCount(group.copies.length, lang)}
        </span>
        <span role="gridcell" className="num">
          {size(group.size)}
        </span>
        <span role="gridcell" className="num">
          {t("dup.free", { size: size(group.free) })}
        </span>
      </div>,
    );
  }
  const cursorShown = cursor !== null && cursor >= first && cursor < last;

  return (
    <div
      className="contents dup-table"
      ref={body}
      role="grid"
      aria-label={t("mode.duplicates")}
      aria-rowcount={groups.length + 1}
      aria-colcount={5}
      aria-activedescendant={cursorShown ? `dgroup-${cursor}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) =>
        tableKeyDown(e, { cursor, viewport, count: groups.length }, actions, isRtl(lang))
      }
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="chead" role="row" style={{ gridTemplateColumns: TEMPLATE }}>
        <span role="columnheader" />
        <span role="columnheader" className="label">
          {t("col.name")}
        </span>
        <span role="columnheader" className="label num">
          {t("dup.colCopies")}
        </span>
        <span role="columnheader" className="label num">
          {t("col.size")}
        </span>
        <span role="columnheader" className="label num">
          {t("dup.colFree")}
        </span>
      </div>
      <div className="crows" style={{ height: groups.length * ROW_HEIGHT }}>
        {rows}
      </div>
    </div>
  );
}

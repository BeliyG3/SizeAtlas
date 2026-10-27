import type { KeyboardEvent } from "react";
import { api } from "../../api/client";
import type { DupGroup } from "../../api/duplicates";
import { formatCount, formatDate } from "../../format";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { mark, markAll, markHow, targets, type MarkHow, type Marks } from "../contents/marks";
import { HEADER_HEIGHT, ROW_HEIGHT } from "../contents/pages";
import { tableKeyDown, type RowActions } from "../contents/tableView";
import { scrollToRow } from "../contents/useCursor";
import { Thumb } from "./Thumb";
import { mimeOf, type ThumbQueue } from "./thumbs";
import "../contents/contents.css";

/** Path, modified, root, marks. */
const TEMPLATE = "minmax(160px, 3fr) 140px minmax(60px, 1fr) minmax(80px, 2fr)";

/** Why a copy is never removed here, or what removing it means. */
const MARKS = ["protected", "noId", "hardlink", "synced"] as const;

/** The marked copies (by index, keyed by `copyMarksKey`) and the cursor row of the table. */
export interface CopyPick {
  marks: Marks;
  cursor: number | null;
}

/** What an action on the copies takes: the marked ones, else the one under the cursor. */
export const pickTargets = (pick: CopyPick) => targets(pick.marks, pick.cursor ?? undefined);

interface Props {
  group: DupGroup;
  pick: CopyPick;
  onPick: (pick: CopyPick) => void;
  /** Delete: the copies at these indices to the trash. Shift+Delete does nothing. */
  onTrash: (indices: number[]) => void;
  /** The menu of the copies at these indices, at viewport coordinates. */
  onMenu: (indices: number[], x: number, y: number) => void;
  queue: ThumbQueue;
  onFail: (e: unknown) => void;
}

/**
 * The copies of one group: where each one lies and what holds it back. Its rows are marked and
 * moved through like those of any table; a double click or Enter shows the copy in the file
 * manager.
 */
export function GroupDetail({ group, pick, onPick, onTrash, onMenu, queue, onFail }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const count = group.copies.length;
  const { marks, cursor } = pick;
  const idAt = (i: number) => (i >= 0 && i < count ? i : undefined);
  const point = (index: number, how: MarkHow) =>
    onPick({ marks: mark(marks, how, index, idAt, cursor ?? index), cursor: index });
  const reveal = (index: number) => {
    const at = group.copies[index]?.refs[0];
    if (at) void api.reveal(at.generation, at.id).catch(onFail);
  };
  /** The keys and clicks; `shown` scrolls a row into view. */
  const actions = (shown: (index: number) => void): RowActions => ({
    point: (index, how) => {
      shown(index);
      point(index, how);
    },
    markAll: () => onPick({ marks: markAll(marks, count, idAt), cursor }),
    trash: () => onTrash(pickTargets(pick)),
    open: reveal,
    menuAt: (index, x, y) => {
      // A row outside the marks is marked on its own, as in the other tables.
      if (marks.ids.has(index) && marks.ids.size > 1) onMenu([...marks.ids], x, y);
      else {
        point(index, "one");
        onMenu([index], x, y);
      }
    },
    up: () => {},
  });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const viewport = Math.max(0, el.clientHeight - HEADER_HEIGHT);
    const keys = actions((index) => scrollToRow(el, index));
    tableKeyDown(e, { cursor, viewport, count }, keys, isRtl(lang));
  };
  const mouse = actions(() => {});
  const cursorShown = cursor !== null && cursor < count;
  return (
    <div className="dup-detail">
      <p className="dup-title">
        <span className="dup-name" dir="auto">
          {t("dup.copies", {
            count,
            copies: formatCount(count, lang),
            name: group.name,
            size: size(group.size),
          })}
        </span>
        {group.stale && <span className="tag dup-warn">{t("dup.groupStale")}</span>}
      </p>
      {mimeOf(group.name) && (
        <div className="dup-preview">
          <Thumb group={group} queue={queue} large />
        </div>
      )}
      {/* ponytail: every copy is rendered; virtualize if groups of thousands of copies show up. */}
      <div
        className="contents dup-table"
        role="grid"
        aria-label={t("dup.colCopies")}
        aria-multiselectable
        aria-rowcount={count + 1}
        aria-colcount={4}
        aria-activedescendant={cursorShown ? `dcopy-${cursor}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="chead" role="row" style={{ gridTemplateColumns: TEMPLATE }}>
          <span role="columnheader" className="label">
            {t("col.path")}
          </span>
          <span role="columnheader" className="label">
            {t("col.modified")}
          </span>
          <span role="columnheader" className="label">
            {t("dup.colRoot")}
          </span>
          <span role="columnheader" />
        </div>
        <div className="crows" style={{ height: count * ROW_HEIGHT }}>
          {group.copies.map((copy, index) => {
            const held = MARKS.filter((m) => copy[m]).map((m) => t(`dup.${m}`));
            const marked = marks.ids.has(index);
            const state = `${index % 2 ? " alt" : ""}${marked ? " selected" : ""}${index === cursor ? " cursor" : ""}`;
            return (
              <div
                key={copy.path}
                id={`dcopy-${index}`}
                data-index={index}
                role="row"
                aria-rowindex={index + 2}
                aria-selected={marked}
                className={`crow${state}`}
                style={{ top: index * ROW_HEIGHT, gridTemplateColumns: TEMPLATE }}
                onClick={(e) => mouse.point(index, markHow(e))}
                onDoubleClick={() => reveal(index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  mouse.menuAt(index, e.clientX, e.clientY);
                }}
              >
                <span role="gridcell" data-col="path" dir="auto" title={copy.path}>
                  {copy.path}
                </span>
                <span role="gridcell">{formatDate(copy.mtime || null, lang)}</span>
                <span role="gridcell" dir="auto" title={copy.root}>
                  {copy.root}
                </span>
                <span role="gridcell" className="tag" title={held.join("\n")}>
                  {held.join(" · ")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

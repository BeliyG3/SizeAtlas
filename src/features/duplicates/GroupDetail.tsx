import type { DupGroup } from "../../api/duplicates";
import { formatCount, formatDate } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ROW_HEIGHT } from "../contents/pages";
import "../contents/contents.css";

/** Path, modified, root, marks. */
const TEMPLATE = "minmax(160px, 3fr) 140px minmax(60px, 1fr) minmax(80px, 2fr)";

/** Why a copy is never removed here, or what removing it means. */
const MARKS = ["protected", "noId", "hardlink", "synced"] as const;

interface Props {
  group: DupGroup;
}

/** The copies of one group: where each one lies and what holds it back. */
export function GroupDetail({ group }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const count = group.copies.length;
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
      {/* ponytail: every copy is rendered; virtualize if groups of thousands of copies show up.
          A table: its rows take no keys yet. */}
      <div className="contents dup-table" role="table" aria-rowcount={count + 1} aria-colcount={4}>
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
            const marks = MARKS.filter((m) => copy[m]).map((m) => t(`dup.${m}`));
            return (
              <div
                key={copy.path}
                data-index={index}
                role="row"
                aria-rowindex={index + 2}
                className={`crow${index % 2 ? " alt" : ""}`}
                style={{ top: index * ROW_HEIGHT, gridTemplateColumns: TEMPLATE }}
              >
                <span role="cell" data-col="path" dir="auto" title={copy.path}>
                  {copy.path}
                </span>
                <span role="cell">{formatDate(copy.mtime || null, lang)}</span>
                <span role="cell" dir="auto" title={copy.root}>
                  {copy.root}
                </span>
                <span role="cell" className="tag" title={marks.join("\n")}>
                  {marks.join(" · ")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

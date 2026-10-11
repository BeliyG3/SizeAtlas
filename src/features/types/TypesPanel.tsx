import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { TypeStats } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { CATEGORY_NAMES } from "../../palette";
import { usePalette, useSize } from "../../settings/react";

interface Props {
  generation: number;
  /** Revision of the tree: a change loads it again. */
  rev: number;
  viewId: number;
  highlight: number | null;
  onHighlight: (category: number | null) => void;
  onFail: (e: unknown) => void;
}

/** Space by file type in the current folder; a click highlights the type in the treemap. */
export function TypesPanel({ generation, rev, viewId, highlight, onHighlight, onFail }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const palette = usePalette();
  const [stats, setStats] = useState<TypeStats | null>(null);
  useEffect(() => {
    let live = true;
    api.getTypeStats(generation, viewId).then(
      (s) => live && setStats(s),
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, rev, viewId, onFail]);

  if (!stats) return null;
  if (stats.items.length === 0) return <p className="dim pad">{t("types.empty")}</p>;
  const total = stats.items.reduce((sum, s) => sum + s.size, 0);
  return (
    <>
      <ul className="panel-list">
        {stats.items.map((s) => {
          const color = palette.categories[s.category] ?? palette.categories[7];
          const active = highlight === s.category;
          return (
            <li key={s.category}>
              <button
                className={`panel-row${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => onHighlight(active ? null : s.category)}
              >
                <span className="swatch" style={{ background: color }} />
                <span className="ellipsis">
                  {t(`category.${CATEGORY_NAMES[s.category] ?? "Other"}`)}{" "}
                  <span className="dim">
                    {t("types.files", { count: s.files, files: formatCount(s.files, lang) })}
                  </span>
                </span>
                <span className="num">{size(s.size)}</span>
                <span className="meter">
                  <span
                    style={{
                      width: `${total > 0 ? (100 * s.size) / total : 0}%`,
                      background: color,
                    }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="dim pad">{t("types.hint")}</p>
    </>
  );
}

import { formatPercent } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { arcPath, type Slice } from "./slices";

interface Props {
  slices: readonly Slice[];
  onPick: (slice: Slice) => void;
}

/** Pie of the current folder; the legend next to it is the keyboard way to pick a slice. */
export function PieChart({ slices, onPick }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  return (
    <div className="pie">
      <svg viewBox="0 0 200 200" role="img" aria-label={t("chart.pieLabel")}>
        {slices.map((s) => (
          <path
            key={s.id ?? "other"}
            d={arcPath(100, 100, 96, s.start, s.start + s.share)}
            fill={s.color}
            stroke="var(--bg)"
            strokeWidth={1}
            className={s.id === null ? undefined : "pick"}
            onClick={() => onPick(s)}
          >
            <title>{`${s.name} — ${formatPercent(s.share, lang)}`}</title>
          </path>
        ))}
      </svg>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.id ?? "other"}>
            <button disabled={s.id === null} onClick={() => onPick(s)}>
              <span className="swatch" style={{ background: s.color }} />
              <span className="ellipsis" dir="auto">
                {s.name}
              </span>
              <span className="num">{formatPercent(s.share, lang)}</span>
              <span className="num dim">{size(s.size)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

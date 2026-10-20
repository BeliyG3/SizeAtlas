import { formatPercent } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import type { Slice } from "./slices";

interface Props {
  slices: readonly Slice[];
  onPick: (slice: Slice) => void;
}

/** Horizontal bars of the largest children; the longest bar fills the track. */
export function BarChart({ slices, onPick }: Props) {
  const { lang } = useT();
  const size = useSize();
  const longest = Math.max(0, ...slices.map((s) => s.share));
  return (
    <ul className="bars">
      {slices.map((s) => (
        <li key={s.id ?? "other"}>
          <button className="bar-row" disabled={s.id === null} onClick={() => onPick(s)}>
            <span className="ellipsis" dir="auto">
              {s.name}
            </span>
            <span className="bar-track">
              <span
                style={{
                  width: `${longest > 0 ? (100 * s.share) / longest : 0}%`,
                  background: s.color,
                }}
              />
            </span>
            <span className="num">{formatPercent(s.share, lang)}</span>
            <span className="num dim">{size(s.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

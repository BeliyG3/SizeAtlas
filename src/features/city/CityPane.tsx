import { useCallback } from "react";
import { ROOT_ID, type Summary } from "../../api/types";
import { useT } from "../../i18n/react";
import { useLiveRevision } from "../scan/useLiveRevision";
import { CityView } from "./CityView";

interface Props {
  /** The selected root's tree; null without a selected root or before its first tree. */
  summary: Summary | null;
  selection: { readonly generation: number | null; readonly id: number } | null;
  onSelect: (generation: number, id: number, isDir: boolean) => void;
  /** Stable: the city's requests depend on it. */
  onFail: (e: unknown) => void;
}

/** The 3D city of the selected root, or a hint while there is no tree to show. */
export function CityPane({ summary, selection, onSelect, onFail }: Props) {
  const { t } = useT();
  const generation = summary?.generation ?? null;
  // A live scan rebuilds the city at its own measured cadence, not on every tick.
  const rev = useLiveRevision(summary?.rev ?? 0, summary?.scanning ?? false, "city", generation);
  const select = useCallback(
    (id: number, isDir: boolean) => {
      if (generation !== null) onSelect(generation, id, isDir);
    },
    [generation, onSelect],
  );
  if (generation === null)
    return (
      <div className="city">
        <p className="city-message dim">{t("city.empty")}</p>
      </div>
    );
  // Ids of another tree (a selection not yet resolved for this one) would be stale here.
  const selectedId = selection?.generation === generation ? selection.id : ROOT_ID;
  return (
    <CityView
      generation={generation}
      rev={rev}
      selectedId={selectedId}
      onSelect={select}
      onFail={onFail}
    />
  );
}

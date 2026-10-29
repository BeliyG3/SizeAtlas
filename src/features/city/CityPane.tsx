import { useT } from "../../i18n/react";
import { CityView } from "./CityView";

interface Props {
  /** Every open root with a tree, at its revision: each is an island if it is a drive. */
  roots: readonly { generation: number; rev: number }[];
  /** The selected node; `generation` is null while its root has no tree. */
  selection: { readonly generation: number | null; readonly id: number } | null;
  /** A folder of the tree with `generation`, picked in the city (stable). */
  onSelect: (generation: number, id: number) => void;
  /** Stable: the city's requests depend on it. */
  onFail: (e: unknown) => void;
}

/** The 3D city of the open drives, or a hint while the selected root has no tree to show. */
export function CityPane({ roots, selection, onSelect, onFail }: Props) {
  const { t } = useT();
  const generation = selection?.generation ?? null;
  if (selection === null || generation === null)
    return (
      <div className="city">
        <p className="city-message dim">{t("city.empty")}</p>
      </div>
    );
  return (
    <CityView
      roots={roots}
      generation={generation}
      selectedId={selection.id}
      onSelect={onSelect}
      onFail={onFail}
    />
  );
}

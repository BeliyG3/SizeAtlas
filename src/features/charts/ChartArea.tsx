import { useState, type ReactNode } from "react";
import type { Crumb } from "../../api/types";
import { useT } from "../../i18n/react";
import { usePalette } from "../../settings/react";
import { useStored } from "../../settings/storage";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { LargestPanel } from "../largest/LargestPanel";
import type { MenuTarget } from "../menu/ItemMenu";
import { Treemap } from "../treemap/Treemap";
import { TypesPanel } from "../types/TypesPanel";
import { Crumbs } from "../viewer/Crumbs";
import { BarChart } from "./BarChart";
import { PieChart } from "./PieChart";
import { buildSlices, type Slice } from "./slices";
import { useTopChildren } from "./useTopChildren";
import "./charts.css";

const MODES = ["pie", "bars", "map", "types", "largest"] as const;
type Mode = (typeof MODES)[number];
const MODE_ICONS: Record<Mode, IconName> = {
  pie: "pie",
  bars: "bars",
  map: "treemap",
  types: "file-types",
  largest: "largest",
};
const parseMode = (raw: string | null): Mode => MODES.find((m) => m === raw) ?? "pie";

interface Props {
  generation: number;
  /** Revision of the tree: a change loads the charts again. */
  rev: number;
  /** Folder the charts show; follows the current folder after a short delay. */
  folder: number;
  /** Path of the current folder. */
  crumbs: readonly Crumb[];
  selectedId: number;
  onSelect: (id: number, isDir: boolean, parent?: number) => void;
  onMenu: (target: MenuTarget) => void;
  onFail: (e: unknown) => void;
}

/** Pie or bars of the largest children; mounted only while shown, so other modes fetch nothing. */
function TopChart({
  kind,
  generation,
  rev,
  folder,
  onSelect,
  onFail,
}: Pick<Props, "generation" | "rev" | "folder" | "onSelect" | "onFail"> & {
  kind: "pie" | "bars";
}) {
  const { t } = useT();
  const palette = usePalette();
  const top = useTopChildren(generation, rev, folder, onFail);
  if (!top) return null;
  const slices = buildSlices(top.page.items, top.page.restSize, palette, t("chart.other"));
  if (slices.length === 0) return <p className="dim pad">{t("chart.empty")}</p>;
  const pick = (s: Slice) => {
    // While another folder loads, the slices still belong to the one they came from.
    if (s.id !== null) onSelect(s.id, s.isDir, top.folder);
  };
  return kind === "pie" ? (
    <PieChart slices={slices} onPick={pick} />
  ) : (
    <BarChart slices={slices} onPick={pick} />
  );
}

export function ChartArea({
  generation,
  rev,
  folder,
  crumbs,
  selectedId,
  onSelect,
  onMenu,
  onFail,
}: Props) {
  const { t } = useT();
  const [mode, setMode] = useStored("sizeatlas.chart", parseMode);
  // Shared by "File types" (where it is chosen) and "Map" (where it dims other types).
  const [highlight, setHighlight] = useState<number | null>(null);

  let body: ReactNode;
  switch (mode) {
    case "pie":
    case "bars":
      body = (
        <TopChart
          kind={mode}
          generation={generation}
          rev={rev}
          folder={folder}
          onSelect={onSelect}
          onFail={onFail}
        />
      );
      break;
    case "map":
      body = (
        <Treemap
          generation={generation}
          rev={rev}
          viewId={folder}
          selectedId={selectedId}
          highlight={highlight}
          onSelect={onSelect}
          onMenu={onMenu}
          onFail={onFail}
        />
      );
      break;
    case "types":
      body = (
        <TypesPanel
          generation={generation}
          rev={rev}
          viewId={folder}
          highlight={highlight}
          onHighlight={setHighlight}
          onFail={onFail}
        />
      );
      break;
    case "largest":
      body = (
        <LargestPanel
          generation={generation}
          rev={rev}
          viewId={folder}
          onSelect={onSelect}
          onMenu={onMenu}
          onFail={onFail}
        />
      );
      break;
  }

  return (
    <section className="charts">
      <div className="charts-bar">
        <div className="tabs joined" role="tablist" aria-label={t("chart.modes")}>
          {MODES.map((m) => (
            <button
              key={m}
              role="tab"
              className="with-icon"
              id={`chart-tab-${m}`}
              aria-selected={mode === m}
              aria-controls="chart-panel"
              onClick={() => setMode(m)}
            >
              <Icon name={MODE_ICONS[m]} />
              {t(`chart.${m}`)}
            </button>
          ))}
        </div>
        <Crumbs crumbs={crumbs} onSelect={onSelect} />
      </div>
      <div
        className="charts-body"
        role="tabpanel"
        id="chart-panel"
        aria-labelledby={`chart-tab-${mode}`}
      >
        {body}
      </div>
    </section>
  );
}

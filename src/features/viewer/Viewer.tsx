import { memo, useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ListItem, Summary } from "../../api/types";
import { useT } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { ChartArea } from "../charts/ChartArea";
import type { SortState } from "../contents/columns";
import { ContentsTable } from "../contents/ContentsTable";
import { useDetails } from "../contents/useDetails";
import { useListBase } from "../lists/base";
import { ListTable } from "../lists/ListTable";
import { isListMode, type Mode } from "../lists/modes";
import type { MenuTarget } from "../menu/ItemMenu";
import { SplitPane } from "../shell/SplitPane";
import { MIN_PANE } from "../shell/split";
import { useCrumbs } from "./useCrumbs";
import { useDebounced } from "./useDebounced";

/** Charts follow the current folder once the selection has settled for this long. */
const VIEW_DELAY_MS = 150;
/** Share of the window height the chart area gets until its border is moved. */
const CHART_SHARE = 0.25;

interface Props {
  summary: Summary;
  /** The selected node of this root and its folder. */
  selection: { readonly id: number; readonly folder: number; readonly fallbackOf?: number };
  /** What the table shows, picked on the toolbar. */
  mode: Mode;
  /** The table sort; kept by the parent, so it survives folder and root changes. */
  sort: SortState;
  onSort: (sort: SortState) => void;
  onSelect: (generation: number, id: number, isDir: boolean, parent?: number) => void;
  onMenu: (generation: number, target: MenuTarget) => void;
  /** Delete in a table: asks to move `ids` of the tree with `generation` to the trash. */
  onTrash: (generation: number, ids: readonly number[]) => void;
  /** The marked rows of the table, whenever they change. */
  onMarks: (ids: readonly number[]) => void;
  /** Stable handler for failed requests. */
  onFail: (e: unknown) => void;
}

/** One open root on the right: the current folder's contents above its charts. Memoized: scan progress re-renders the parent about ten times a second. */
export const Viewer = memo(function Viewer({
  summary,
  selection,
  mode,
  sort,
  onSort,
  onSelect,
  onMenu,
  onTrash,
  onMarks,
  onFail,
}: Props) {
  const { t } = useT();
  const { showChart } = useSettings();
  const { generation } = summary;
  const select = useCallback(
    (id: number, isDir: boolean, parent?: number) => onSelect(generation, id, isDir, parent),
    [generation, onSelect],
  );
  const menu = useCallback(
    (target: MenuTarget) => onMenu(generation, target),
    [generation, onMenu],
  );
  const trash = useCallback(
    (ids: readonly number[]) => onTrash(generation, ids),
    [generation, onTrash],
  );
  const crumbs = useCrumbs(generation, summary.rev, selection.folder, onFail);
  const shownFolder = useDebounced(selection.folder, VIEW_DELAY_MS);
  const listing = isListMode(mode);
  const { base, pick, enter } = useListBase(selection, listing);
  // A change can remove the list's own folder: the list then goes to its nearest live ancestor.
  useEffect(() => {
    if (!listing || summary.rev === 0) return;
    let live = true;
    api.getLiveAncestor(generation, base).then((alive) => {
      if (live && alive !== base) enter(alive);
    }, onFail);
    return () => {
      live = false;
    };
  }, [listing, generation, summary.rev, base, enter, onFail]);
  const pickItem = useCallback(
    (item: ListItem) => {
      pick(item.id);
      select(item.id, item.isDir, item.parent);
    },
    [pick, select],
  );
  const enterFolder = useCallback(
    (id: number, parent?: number) => {
      enter(id);
      select(id, true, parent);
    },
    [enter, select],
  );
  const { details, request: needDetails } = useDetails(generation, onFail);
  const parent = crumbs.length >= 2 ? crumbs[crumbs.length - 2].id : null;
  // The list's folder is the current folder or above it, so among its crumbs.
  const baseAt = crumbs.findIndex((c) => c.id === base);
  const baseParent = baseAt > 0 ? crumbs[baseAt - 1].id : null;
  // Read once by SplitPane, when it mounts without a stored size.
  const [chartHeight] = useState(() =>
    Math.max(MIN_PANE, Math.round(window.innerHeight * CHART_SHARE)),
  );

  return (
    <SplitPane
      direction="column"
      sized="second"
      storageKey="sizeatlas.split.charts"
      defaultSize={chartHeight}
      label={t("split.charts")}
      collapse={showChart ? undefined : "second"}
      first={
        <>
          {isListMode(mode) ? (
            <ListTable
              key={`${mode}:${base}`}
              summary={summary}
              kind={mode}
              base={base}
              parent={baseParent}
              selectedId={selection.id}
              details={details}
              onNeedDetails={needDetails}
              onPick={pickItem}
              onEnter={enterFolder}
              onMenu={menu}
              onTrash={trash}
              onMarks={onMarks}
              onFail={onFail}
            />
          ) : (
            <ContentsTable
              summary={summary}
              folder={selection.folder}
              parent={parent}
              selectedId={selection.id}
              sort={sort}
              onSort={onSort}
              dirsOnly={mode === "folders"}
              details={details}
              onNeedDetails={needDetails}
              onSelect={select}
              onMenu={menu}
              onTrash={trash}
              onMarks={onMarks}
              onFail={onFail}
            />
          )}
        </>
      }
      second={
        <ChartArea
          generation={generation}
          rev={summary.rev}
          folder={shownFolder}
          crumbs={crumbs}
          selectedId={selection.id}
          onSelect={select}
          onMenu={menu}
          onFail={onFail}
        />
      }
    />
  );
});

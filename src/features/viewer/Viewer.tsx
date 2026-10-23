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
import { listShown, type Mode } from "../lists/modes";
import type { MenuTarget } from "../menu/ItemMenu";
import { SplitPane } from "../shell/SplitPane";
import { MIN_PANE } from "../shell/split";
import { crumbsPath } from "../export/names";
import { useCrumbs } from "./useCrumbs";
import { useDebounced } from "./useDebounced";
import { useLiveRevision } from "../scan/useLiveRevision";

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
  /** The words searched for: while they are not blank, the table shows the results over any mode. */
  query: string;
  /** Enter or a double click on a folder of the results: the search is over (stable). */
  onLeaveSearch: () => void;
  /** The table sort; kept by the parent, so it survives folder and root changes. */
  sort: SortState;
  onSort: (sort: SortState) => void;
  onSelect: (generation: number, id: number, isDir: boolean, parent?: number) => void;
  onMenu: (generation: number, target: MenuTarget) => void;
  /**
   * Delete in a table: asks to move `ids` of the tree with `generation` to the trash;
   * `cleanup`: rows of a clean-up list.
   */
  onTrash: (generation: number, ids: readonly number[], cleanup?: boolean) => void;
  /** Shift+Delete in a clean-up list: asks to delete `ids` for good. */
  onPurge: (generation: number, ids: readonly number[]) => void;
  /** The marked rows of the table, whenever they change; `cleanup`: of a clean-up list. */
  onMarks: (ids: readonly number[], cleanup?: boolean) => void;
  /** Stable handler for failed requests. */
  onFail: (e: unknown) => void;
}

/** One open root on the right: the current folder's contents above its charts. Memoized: scan progress re-renders the parent about ten times a second. */
export const Viewer = memo(function Viewer({
  summary,
  selection,
  mode,
  query,
  onLeaveSearch,
  sort,
  onSort,
  onSelect,
  onMenu,
  onTrash,
  onPurge,
  onMarks,
  onFail,
}: Props) {
  const { t } = useT();
  const { showChart } = useSettings();
  const { generation } = summary;
  const chartRev = useLiveRevision(summary.rev, summary.scanning ?? false, "charts");
  const select = useCallback(
    (id: number, isDir: boolean, parent?: number) => onSelect(generation, id, isDir, parent),
    [generation, onSelect],
  );
  const menu = useCallback(
    (target: MenuTarget) => onMenu(generation, target),
    [generation, onMenu],
  );
  const trash = useCallback(
    (ids: readonly number[], cleanup = false) => onTrash(generation, ids, cleanup),
    [generation, onTrash],
  );
  const purge = useCallback(
    (ids: readonly number[]) => onPurge(generation, ids),
    [generation, onPurge],
  );
  const crumbs = useCrumbs(generation, summary.rev, selection.folder, onFail);
  const shownFolder = useDebounced(selection.folder, VIEW_DELAY_MS);
  const list = listShown(mode, query);
  const listing = list !== null;
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
  // A folder of the results is shown, not searched: the search ends, the list is made for it.
  const leaveSearch = useCallback(
    (id: number, parent?: number) => {
      onLeaveSearch();
      enterFolder(id, parent);
    },
    [onLeaveSearch, enterFolder],
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
        list !== null ? (
          <ListTable
            // One table for all queries: typing does not remount, the query refetches.
            key={`${list}:${base}`}
            summary={summary}
            kind={list}
            query={query}
            base={base}
            basePath={crumbsPath(crumbs.slice(0, baseAt + 1))}
            parent={baseParent}
            selectedId={selection.id}
            details={details}
            onNeedDetails={needDetails}
            onPick={pickItem}
            onEnter={enterFolder}
            onOpenFolder={list === "search" ? leaveSearch : undefined}
            onMenu={menu}
            onTrash={trash}
            onPurge={purge}
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
        )
      }
      second={
        <ChartArea
          generation={generation}
          rev={chartRev}
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

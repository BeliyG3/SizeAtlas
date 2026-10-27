import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RootStatus, Summary } from "../../api/types";
import { useT } from "../../i18n/react";
import { noMarks } from "../contents/marks";
import { words } from "../search/useCommittedQuery";
import { serializeShown } from "../../settings/settings";
import { useStored } from "../../settings/storage";
import { SplitPane } from "../shell/SplitPane";
import {
  DEFAULT_GROUP_SORT,
  GROUP_SORTS,
  GROUP_SORT_KEY,
  parseDupSort,
  serializeDupSort,
  sortGroups,
} from "./columns";
import { CopyMenu } from "./CopyMenu";
import { DupHeader } from "./DupHeader";
import { emptyKey } from "./emptyState";
import { GroupDetail, pickTargets, type CopyPick } from "./GroupDetail";
import { GroupList } from "./GroupList";
import { copyMarksKey, copyTrashNote } from "./keep";
import { DUP_SYSTEM_KEY, parseDupSystem } from "./query";
import { createThumbQueue } from "./thumbs";
import { useDupTrash, type DupRuns } from "./useDupTrash";
import { useDuplicates } from "./useDuplicates";
import "./duplicates.css";

/** Width of the group list until its border is moved. */
const LIST_WIDTH = 420;

/** What Delete outside the tables and Scan › Move to the trash do in this mode (`menuTrashFor`). */
export interface DupMenuTrash {
  /** Null while the copies picked cannot go (or none are). */
  run: (() => void) | null;
  /** Why they cannot. */
  note: string | null;
}

/** What the app gives the duplicates mode, passed through the browser as one prop. */
export interface DupWiring {
  /** The text in the field now: what Find searches for (the committed words lag behind it). */
  field: string;
  /** Commits the words Find searches for, so the estimate catches up at once. */
  onCommit: (words: string) => void;
  runs: DupRuns;
  push: (text: string) => void;
  errorText: (e: unknown) => string;
  /** Shows the trees without the removed copies at once. */
  onTrashed: () => void;
  /** Told whenever the trash of the copies picked changes (stable). */
  onMenuTrash: (menu: DupMenuTrash) => void;
}

interface Props extends DupWiring {
  /** The words of the search field (committed): what the estimate is made for. */
  query: string;
  /** The open roots: any change of one updates the estimate and the stale mark. */
  entries: readonly { root: string; summary: Summary | null; status: RootStatus }[];
  /** Whether a request, started or waiting, has one of `ids` of the tree with `generation`. */
  isRemoving: (generation: number, ids: readonly number[]) => boolean;
  onFail: (e: unknown) => void;
}

const NOTHING: DupMenuTrash = { run: null, note: null };
const parseGroupSort = (raw: string | null) => parseDupSort(raw, GROUP_SORTS, DEFAULT_GROUP_SORT);

/** The duplicates mode: the search above, the groups on the left, the copies of one on the right. */
export function DuplicatesView(props: Props) {
  const { query, field, onCommit, runs, push, errorText, onTrashed, onMenuTrash } = props;
  const { entries, isRemoving, onFail } = props;
  const { t } = useT();
  const [system, setSystem] = useStored(DUP_SYSTEM_KEY, parseDupSystem, serializeShown);
  const rootsKey = useMemo(
    () =>
      entries
        .map((e) => `${e.root}|${e.summary?.generation ?? ""}|${e.summary?.rev ?? ""}|${e.status}`)
        .join("\n"),
    [entries],
  );
  const dups = useDuplicates({ query, system, rootsKey, onFail });
  const { state, status, estimate, finding, find, cancel, refresh } = dups;
  const running = status?.running ?? state?.answer.running ?? false;
  const dupTrash = useDupTrash({
    entries,
    runs,
    isRemoving,
    push,
    errorText,
    onError: onFail,
    onTrashed,
    running,
    refresh,
  });
  const [queue] = useState(() => createThumbQueue());
  const [sort, setSort] = useStored(GROUP_SORT_KEY, parseGroupSort, serializeDupSort);
  const groups = useMemo(() => sortGroups(state?.groups.values() ?? [], sort), [state, sort]);
  const [picked, setPicked] = useState<string | null>(null);
  // A change without the picked group shows the first one.
  const selected = groups.find((g) => g.key === picked) ?? groups[0] ?? null;
  // Another order keeps the group shown, and so its marks, even one shown as the first.
  const shownKey = selected?.key ?? null;
  const onSortGroups = useCallback(
    (next: typeof sort) => {
      setPicked(shownKey);
      setSort(next);
    },
    [shownKey, setSort],
  );
  // Marks belong to one group as it is: another group, or this one changed, starts without any.
  const key = selected && state ? copyMarksKey(state.job, selected) : "";
  const [stored, setPick] = useState<CopyPick>({ marks: noMarks(key), cursor: null });
  const pick = stored.marks.key === key ? stored : { marks: noMarks(key), cursor: null };
  if (pick !== stored) setPick(pick);
  const [menu, setMenu] = useState<{ key: string; at: number[]; x: number; y: number } | null>(
    null,
  );

  const copiesAt = (at: readonly number[]) =>
    selected ? at.flatMap((i) => selected.copies[i] ?? []) : [];
  /** Why the copies at `at` cannot go now, as a text key; null when they can. */
  const noteFor = (at: readonly number[]) => {
    if (!selected) return "dup.lastCopy";
    const removing = copiesAt(at).some((c) => c.refs.some((r) => isRemoving(r.generation, [r.id])));
    return copyTrashNote(selected, new Set(at), running, removing);
  };
  const trash = (at: readonly number[]) => {
    if (at.length === 0) return;
    const note = noteFor(at);
    if (note) push(t(note));
    else dupTrash.ask(copiesAt(at));
  };

  // Delete outside the tables and the menu bar take the copies picked here, never the tree's.
  const targets = pickTargets(pick);
  const noteKey = targets.length > 0 ? noteFor(targets) : null;
  const note = noteKey && t(noteKey);
  const canRun = targets.length > 0 && noteKey === null;
  const latest = useRef(() => trash(targets));
  useLayoutEffect(() => {
    latest.current = () => trash(targets);
  });
  const run = useCallback(() => latest.current(), []);
  useEffect(() => {
    onMenuTrash({ run: canRun ? run : null, note });
  }, [onMenuTrash, run, canRun, note]);
  useEffect(() => () => onMenuTrash(NOTHING), [onMenuTrash]);

  const empty = emptyKey({ estimate, state, status });
  const text = words(field);
  const onFind = () => {
    onCommit(text);
    find(text);
  };
  const menuOpen = menu !== null && menu.key === key;
  const menuNote = menuOpen ? noteFor(menu.at) : null;

  return (
    <div className="dups">
      <DupHeader
        estimate={estimate}
        state={state}
        status={status}
        query={text}
        system={system}
        // The backend refuses a search while a trash of copies runs.
        finding={finding || runs.pending}
        onSystem={setSystem}
        onFind={onFind}
        onCancel={cancel}
      />
      {selected ? (
        <SplitPane
          direction="row"
          sized="first"
          storageKey="sizeatlas.split.duplicates"
          defaultSize={LIST_WIDTH}
          label={t("split.groups")}
          first={
            <GroupList
              groups={groups}
              selected={selected.key}
              onPick={setPicked}
              sort={sort}
              onSort={onSortGroups}
              queue={queue}
            />
          }
          second={
            <GroupDetail
              group={selected}
              pick={pick}
              onPick={setPick}
              onTrash={trash}
              onMenu={(at, x, y) => setMenu({ key, at, x, y })}
              queue={queue}
              onFail={onFail}
            />
          }
        />
      ) : (
        empty && <p className="empty-hint dim">{t(empty)}</p>
      )}
      {menuOpen && (
        <CopyMenu
          copies={copiesAt(menu.at)}
          x={menu.x}
          y={menu.y}
          canTrash={menuNote === null}
          trashNote={menuNote && t(menuNote)}
          onTrash={() => trash(menu.at)}
          onClose={() => setMenu(null)}
          onFail={onFail}
        />
      )}
      {dupTrash.dialog}
    </div>
  );
}

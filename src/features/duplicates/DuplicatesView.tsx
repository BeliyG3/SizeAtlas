import { useMemo, useState } from "react";
import { useT } from "../../i18n/react";
import { words } from "../search/useCommittedQuery";
import { serializeShown } from "../../settings/settings";
import { useStored } from "../../settings/storage";
import { SplitPane } from "../shell/SplitPane";
import { DupHeader } from "./DupHeader";
import { emptyKey } from "./emptyState";
import { GroupDetail } from "./GroupDetail";
import { GroupList } from "./GroupList";
import { sortGroups } from "./groups";
import { DUP_SYSTEM_KEY, parseDupSystem } from "./query";
import { useDuplicates } from "./useDuplicates";
import "./duplicates.css";

/** Width of the group list until its border is moved. */
const LIST_WIDTH = 420;

interface Props {
  /** The words of the search field (committed): what the estimate is made for. */
  query: string;
  /** The text in the field now: what Find searches for (the committed words lag behind it). */
  field: string;
  /** Commits the words Find searches for, so the estimate catches up at once. */
  onCommit: (words: string) => void;
  /** Changes whenever an open root does. */
  rootsKey: string;
  onFail: (e: unknown) => void;
}

/** The duplicates mode: the search above, the groups on the left, the copies of one on the right. */
export function DuplicatesView({ query, field, onCommit, rootsKey, onFail }: Props) {
  const { t } = useT();
  const [system, setSystem] = useStored(DUP_SYSTEM_KEY, parseDupSystem, serializeShown);
  const { state, status, estimate, finding, find, cancel } = useDuplicates({
    query,
    system,
    rootsKey,
    onFail,
  });
  const groups = useMemo(() => sortGroups(state?.groups.values() ?? []), [state]);
  const [picked, setPicked] = useState<string | null>(null);
  // A change without the picked group shows the first one.
  const selected = groups.find((g) => g.key === picked) ?? groups[0] ?? null;
  const empty = emptyKey({ estimate, state, status });
  const text = words(field);
  const onFind = () => {
    onCommit(text);
    find(text);
  };

  return (
    <div className="dups">
      <DupHeader
        estimate={estimate}
        state={state}
        status={status}
        query={text}
        system={system}
        finding={finding}
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
          first={<GroupList groups={groups} selected={selected.key} onPick={setPicked} />}
          second={<GroupDetail group={selected} />}
        />
      ) : (
        empty && <p className="empty-hint dim">{t(empty)}</p>
      )}
    </div>
  );
}

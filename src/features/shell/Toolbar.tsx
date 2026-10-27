import type { RefObject } from "react";
import type { Sources } from "../../api/types";
import { useT } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { ModeMenu } from "../lists/ModeMenu";
import type { Mode } from "../lists/modes";
import { SearchField } from "../search/SearchField";
import { SourcePicker } from "./SourcePicker";
import { forgettable, sourceAction, type SourceAction } from "./source";
import "./shell.css";

/** Icon of the main button, by what it does. */
const ACTION_ICONS: Record<SourceAction, IconName> = {
  open: "folder-open",
  scan: "scan",
  rescan: "refresh",
};

interface Props {
  /** Back and forward through the visited folders. */
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  sources: Sources | null;
  /** The source picked in the list; by default the root of the selected node. */
  pending: string | null;
  /** Root of the selected node. */
  selectedRoot: string | null;
  /** Roots in the folder tree. */
  inTree: ReadonlySet<string>;
  /** Roots whose scan runs or waits: scanning them again would do nothing. */
  waiting: ReadonlySet<string>;
  /** A scan runs: Cancel stops it. */
  scanning: boolean;
  onPick: (path: string) => void;
  /** Selects the source if it is in the tree, else opens its saved scan. */
  onOpen: (path: string) => void;
  /** Queues a scan of the source. */
  onScan: (path: string) => void;
  /** "Choose folder…" in the list. */
  onChooseFolder: () => void;
  onCancel: () => void;
  /** Deletes the saved scan of `root`, closing it if it is open. */
  onForget: (root: string) => void;
  /** What the table shows. */
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** The text in the search field, and Enter in it; `searchRef` is the field, for Ctrl+F. */
  query: string;
  onQuery: (query: string) => void;
  onSearch: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

/**
 * Back and forward, the source list and its main button, Cancel, Forget, the table mode, the
 * search and the 3D city toggle.
 */
export function Toolbar({
  canBack,
  canForward,
  onBack,
  onForward,
  sources,
  pending,
  selectedRoot,
  inTree,
  waiting,
  scanning,
  onPick,
  onOpen,
  onScan,
  onChooseFolder,
  onCancel,
  onForget,
  mode,
  onMode,
  query,
  onQuery,
  onSearch,
  searchRef,
}: Props) {
  const { t } = useT();
  const { showCity, setShowCity } = useSettings();
  const action = sourceAction(pending, selectedRoot, inTree, sources?.scans ?? []);
  const ready = action === "open" || (pending !== null && !waiting.has(pending));
  const forget = forgettable(sources, pending);

  const run = () => {
    if (pending === null || action === null) return;
    if (action === "open") onOpen(pending);
    else onScan(pending);
  };

  return (
    <header className="toolbar">
      <div className="joined">
        <button
          className="nav"
          disabled={!canBack}
          title={t("toolbar.back")}
          aria-label={t("toolbar.back")}
          onClick={onBack}
        >
          <Icon name="back" className="icon-dir" />
        </button>
        <button
          className="nav"
          disabled={!canForward}
          title={t("toolbar.forward")}
          aria-label={t("toolbar.forward")}
          onClick={onForward}
        >
          <Icon name="forward" className="icon-dir" />
        </button>
      </div>
      <SourcePicker
        sources={sources}
        pending={pending}
        onPick={onPick}
        onChooseFolder={onChooseFolder}
      />
      <button className="primary with-icon" disabled={action === null || !ready} onClick={run}>
        <Icon name={ACTION_ICONS[action ?? "scan"]} />
        {t(`toolbar.${action ?? "scan"}`)}
      </button>
      <button className="with-icon" disabled={!scanning} onClick={onCancel}>
        <Icon name="cancel" />
        {t("toolbar.cancel")}
      </button>
      <button
        className="with-icon"
        disabled={forget === null}
        title={
          forget === null
            ? undefined
            : t(inTree.has(forget) ? "toolbar.forgetOpenHint" : "toolbar.forgetHint", {
                root: forget,
              })
        }
        onClick={() => forget !== null && onForget(forget)}
      >
        <Icon name="forget" />
        {t("toolbar.forget")}
      </button>
      <ModeMenu value={mode} onChange={onMode} />
      <SearchField value={query} onChange={onQuery} onCommit={onSearch} inputRef={searchRef} />
      <button
        className="nav toggle"
        aria-pressed={showCity}
        title={t("toolbar.city")}
        aria-label={t("toolbar.city")}
        onClick={() => setShowCity(!showCity)}
      >
        <Icon name="city" />
      </button>
    </header>
  );
}

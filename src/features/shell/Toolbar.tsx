import type { Sources } from "../../api/types";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { ModeMenu } from "../lists/ModeMenu";
import type { Mode } from "../lists/modes";
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
}

/** Back and forward, the source list and its main button, Cancel, Forget and the table mode. */
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
}: Props) {
  const { t } = useT();
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
    </header>
  );
}

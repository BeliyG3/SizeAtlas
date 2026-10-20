import type { Sources } from "../../api/types";
import { Icon } from "../icons/Icon";
import { MenuChoice } from "../menu/MenuChoice";
import { diskLabel, folderLabel, recentFolders, type Translate } from "./source";

interface Props {
  sources: Sources | null;
  /** The source picked now; one that is in neither list is shown first. */
  pending: string | null;
  t: Translate;
  onPick: (path: string) => void;
  onChooseFolder: () => void;
}

/** Items of the source menu: drives, recent folders, then "Choose folder…". */
export function SourceItems({ sources, pending, t, onPick, onChooseFolder }: Props) {
  const folders = recentFolders(sources);
  const listed = new Set([
    ...(sources?.disks.map((d) => d.mount) ?? []),
    ...folders.map((s) => s.root),
  ]);
  const choice = (root: string, label: string, icon: "drive" | "folder", dim = false) => (
    <MenuChoice
      key={root}
      kind="radio"
      checked={root === pending}
      label={label}
      icon={icon}
      dim={dim}
      onPick={() => onPick(root)}
    />
  );
  return (
    <>
      {pending !== null && !listed.has(pending) && choice(pending, pending, "folder")}
      <div className="heading">{t("toolbar.drives")}</div>
      {sources?.disks.map((d) => choice(d.mount, diskLabel(d, t), "drive", !d.connected))}
      {folders.length > 0 && (
        <>
          <div className="heading">{t("toolbar.recent")}</div>
          {folders.map((s) => choice(s.root, folderLabel(s, t), "folder"))}
        </>
      )}
      <div role="separator" />
      <button role="menuitem" className="iconic" onClick={onChooseFolder}>
        <Icon name="choose-folder" />
        {t("toolbar.chooseFolder")}
      </button>
    </>
  );
}

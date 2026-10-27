import { Fragment } from "react";
import { api } from "../../api/client";
import type { DupCopy } from "../../api/duplicates";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { Menu } from "../menu/Menu";

/** Only Windows has a Properties dialog, and ends copied lines with CR LF. */
const WINDOWS = /Windows/i.test(navigator.userAgent);

interface Props {
  /** The copies it acts on: the marked ones it opened on, else the one under it. */
  copies: readonly DupCopy[];
  x: number;
  y: number;
  /** They can go to the trash now (`copyTrashNote` is null). */
  canTrash: boolean;
  /** Why they cannot, the tooltip of the disabled item. */
  trashNote: string | null;
  onTrash: () => void;
  onClose: () => void;
  onFail: (e: unknown) => void;
}

/** The context menu of copies of a group. No "delete permanently": copies only go to the trash. */
export function CopyMenu({ copies, x, y, canTrash, trashNote, onTrash, onClose, onFail }: Props) {
  const { t, lang } = useT();
  const many = copies.length > 1;
  const at = copies[0]?.refs[0];
  const onCopy = (call: (generation: number, id: number) => Promise<void>) => {
    if (at) void call(at.generation, at.id).catch(onFail);
  };
  const item = (icon: IconName, label: string, run: () => void, enabled = true, note?: string) => (
    <button
      key={label}
      role="menuitem"
      disabled={!enabled}
      title={note}
      onClick={() => {
        run();
        onClose();
      }}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
  const paths = copies.map((c) => c.path).join(WINDOWS ? "\r\n" : "\n");
  const counted = { count: copies.length, items: formatCount(copies.length, lang) };
  const groups = [
    !many && [
      item("open", t("menu.open"), () => onCopy(api.openItem)),
      item("reveal", t("menu.reveal"), () => onCopy(api.reveal)),
      WINDOWS && item("properties", t("menu.properties"), () => onCopy(api.showProperties)),
    ],
    [
      item("copy", t(many ? "menu.copyPaths" : "menu.copyPath"), () => {
        void api.copyText(paths).catch(onFail);
      }),
    ],
    [
      item(
        "trash",
        many ? t("menu.trashMany", counted) : t("menu.trash"),
        onTrash,
        canTrash,
        trashNote ?? undefined,
      ),
    ],
  ].filter((group) => group !== false);
  return (
    <Menu x={x} y={y} onClose={onClose}>
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <div role="separator" />}
          {group}
        </Fragment>
      ))}
    </Menu>
  );
}

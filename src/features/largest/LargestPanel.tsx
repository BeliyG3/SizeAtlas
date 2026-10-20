import { useBatchCost } from "../scan/useBatchCost";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { List, ListItem } from "../../api/types";
import { isRtl } from "../../i18n";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ItemIcon } from "../contents/ItemIcon";
import type { MenuTarget } from "../menu/ItemMenu";
import { isMenuKey } from "../menu/Menu";
import { anchorX } from "../menu/place";

const LIMIT = 100;

interface Props {
  generation: number;
  /** Revision of the tree: a change loads it again. */
  rev: number;
  viewId: number;
  onSelect: (id: number, isDir: boolean, parent?: number) => void;
  onMenu: (target: MenuTarget) => void;
  onFail: (e: unknown) => void;
}

/** The largest files of the current folder; a click shows the file in the tree. */
export function LargestPanel({ generation, rev, viewId, onSelect, onMenu, onFail }: Props) {
  const { t, lang } = useT();
  const size = useSize();
  const [files, setFiles] = useState<List | null>(null);
  const measure = useBatchCost("charts", files);
  useEffect(() => {
    let live = true;
    const applied = measure();
    api.getList(generation, viewId, "largestFiles", LIMIT).then(
      (f) => {
        if (!live) return;
        applied();
        setFiles(f);
      },
      (e: unknown) => live && onFail(e),
    );
    return () => {
      live = false;
    };
  }, [generation, rev, viewId, onFail, measure]);

  const menuAt = (f: ListItem, x: number, y: number) =>
    onMenu({ id: f.id, isDir: false, lossy: f.lossy, x, y });

  if (!files) return null;
  if (files.items.length === 0) return <p className="dim pad">{t("largest.empty")}</p>;
  return (
    <ul className="panel-list">
      {files.items.map((f) => (
        <li key={f.id}>
          <button
            className="panel-row file"
            title={f.folder || undefined}
            onClick={() => onSelect(f.id, false, f.parent)}
            onContextMenu={(e) => {
              e.preventDefault();
              menuAt(f, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              if (!isMenuKey(e)) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              menuAt(f, anchorX(box, isRtl(lang), 24), box.bottom);
            }}
          >
            <ItemIcon isDir={false} category={f.category} />
            <span className="ellipsis">
              {f.name}
              {f.folder && <span className="dim folder ellipsis">{f.folder}</span>}
            </span>
            <span className="num">{size(f.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

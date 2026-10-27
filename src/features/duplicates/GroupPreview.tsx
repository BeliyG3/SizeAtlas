import { useState } from "react";
import { api } from "../../api/client";
import type { DupCopy, DupGroup } from "../../api/duplicates";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import { ItemIcon } from "../contents/ItemIcon";
import { Icon } from "../icons/Icon";
import { WINDOWS } from "./platform";
import { mimeOf } from "./thumbs";
import type { Picture } from "./viewer/useImageUrl";
import { ZoomView } from "./viewer/ZoomView";

interface TitleProps {
  group: DupGroup;
  /** The copy the buttons open: the one under the cursor, else the first in table order. */
  target: DupCopy | undefined;
  onFull: () => void;
  onWindow: () => void;
  onFail: (e: unknown) => void;
}

/**
 * The name, count and size of a group, with Open, Open with… (Windows) and, for a picture type,
 * Full screen and Separate window: by the name, so they stay while its picture loads or fails.
 */
export function GroupTitle({ group, target, onFull, onWindow, onFail }: TitleProps) {
  const { t, lang } = useT();
  const size = useSize();
  const count = group.copies.length;
  const at = target?.refs[0];
  const open = (call: (generation: number, id: number) => Promise<void>) => () => {
    if (at) void call(at.generation, at.id).catch(onFail);
  };
  const picture = mimeOf(group.name) !== null;
  const title = t("dup.copies", {
    count,
    copies: formatCount(count, lang),
    name: group.name,
    size: size(group.size),
  });
  return (
    <p className="dup-title">
      {/* Cut short beside the buttons: the tooltip has all of it. */}
      <span className="dup-name" dir="auto" title={title}>
        {title}
      </span>
      {group.stale && <span className="tag dup-warn">{t("dup.groupStale")}</span>}
      <span className="dup-actions">
        <button type="button" onClick={open(api.openItem)}>
          <Icon name="open" />
          {t("menu.open")}
        </button>
        {WINDOWS && (
          <button type="button" onClick={open(api.openWith)}>
            {t("menu.openWith")}
          </button>
        )}
        {picture && (
          <button type="button" onClick={onFull}>
            {t("dup.view.full")}
          </button>
        )}
        {picture && (
          <button type="button" onClick={onWindow}>
            {t("dup.view.window")}
          </button>
        )}
      </span>
    </p>
  );
}

interface PictureProps {
  group: DupGroup;
  picture: Picture;
}

/**
 * The picture of a group, fitted and never blown up, to zoom and pan in place; the icon of its
 * category until it comes, when there is none, and when the webview cannot decode it.
 */
export function PreviewPicture({ group, picture }: PictureProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const url = picture.state === "ready" && picture.url !== broken ? picture.url : null;
  return (
    <div className="dup-preview">
      {url ? (
        // The name is in the title above: no label of its own.
        <ZoomView url={url} label="" onError={() => setBroken(url)} />
      ) : (
        <ItemIcon isDir={false} category={group.category} />
      )}
    </div>
  );
}

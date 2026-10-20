import type { CachedScan, Disk } from "../../api/types";
import { isolate } from "../../i18n";
import { useT } from "../../i18n/react";
import { Icon } from "../icons/Icon";
import type { Translate } from "../shell/source";

interface Props {
  disk: Disk;
  /** Its saved scan, if any: the mark shows whether it is current. */
  saved: CachedScan | null | undefined;
  t: Translate;
}

/** The name cell of a drive row: icon, mount path, label, state and saved-scan mark. */
export function DriveName({ disk: d, saved, t }: Props) {
  const { lang } = useT();
  const mark = saved && {
    label: t(saved.outdated ? "drives.outdated" : "drives.saved"),
    glyph: saved.outdated ? "○" : "●",
  };
  const state = d.connected ? "" : ` · ${t("drives.disconnected")}`;
  // A narrow panel cuts the cells short: each shows in full on hover.
  return (
    <td data-col="name" title={isolate(`${d.mount} ${d.name}${state}`, lang)}>
      <Icon name={d.network ? "network-drive" : "drive"} className="drive-icon" />{" "}
      {/* The mount path keeps its direction: "Z:\" stays "Z:\" next to Arabic text. */}
      <bdi>{d.mount}</bdi> <span className="dim">{d.name}</span>
      {state && <span className="dim">{state}</span>}
      {mark && (
        <span className="mark" role="img" aria-label={mark.label} title={mark.label}>
          {mark.glyph}
        </span>
      )}
    </td>
  );
}

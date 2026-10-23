import type { InfoDto } from "../../api/types";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";

interface Props {
  info: readonly InfoDto[];
  /** The restart as administrator for the lines of unreadable places; null where it cannot help. */
  restart: { busy: boolean; run: () => void } | null;
  /** Puts the command of a tool on the clipboard. */
  onCopy: (command: string) => void;
}

/**
 * The facts under the total of a clean-up list, one line each: places SizeAtlas never deletes
 * (what to do about them), a tool's own command, unreadable places and running apps. Not rows:
 * nothing here is counted or deleted.
 */
export function InfoBlock({ info, restart, onCopy }: Props) {
  const { t } = useT();
  const size = useSize();
  if (info.length === 0) return null;
  return (
    <ul className="cleanup-info">
      {info.map((line, i) => (
        <li key={`${line.kind}:${line.path ?? line.app ?? i}`}>
          <span>
            {t(`cleanup.info.${line.kind}`, {
              path: line.path ?? "",
              size: line.size === null ? "" : size(line.size),
              app: line.app ?? "",
            })}
          </span>
          {line.command && (
            <>
              {" "}
              <code dir="ltr">{line.command}</code>{" "}
              <span className="dim">{t("cleanup.commandNote")}</span>{" "}
              <button onClick={() => onCopy(line.command!)}>{t("cleanup.copyCommand")}</button>
            </>
          )}
          {line.kind === "noAccess" && restart && (
            <>
              {" "}
              <button disabled={restart.busy} onClick={restart.run}>
                {t("banner.restartElevated")}
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

import { Fragment } from "react";
import type { Crumb } from "../../api/types";
import { useT } from "../../i18n/react";

interface Props {
  crumbs: readonly Crumb[];
  onSelect: (id: number, isDir: boolean) => void;
}

/** Path from the scan root to the current folder; every part but the last opens its folder. */
export function Crumbs({ crumbs, onSelect }: Props) {
  const { t } = useT();
  return (
    <nav className="crumbs" aria-label={t("crumbs.label")}>
      {crumbs.map((c, i) =>
        i === crumbs.length - 1 ? (
          <span key={c.id} aria-current="location">
            {c.name}
          </span>
        ) : (
          <Fragment key={c.id}>
            <button className="link" onClick={() => onSelect(c.id, true)}>
              {c.name}
            </button>
            <span className="dim icon-dir" aria-hidden="true">
              ›
            </span>
          </Fragment>
        ),
      )}
    </nav>
  );
}

import type { ReactNode } from "react";
import { useT } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { SplitPane } from "./SplitPane";

interface Props {
  tree: ReactNode;
  drives: ReactNode;
  content: ReactNode;
}

/**
 * Window body: the folder tree above the drives on the left (View › Drives panel hides them), the
 * content on the right.
 */
export function Workspace({ tree, drives, content }: Props) {
  const { t } = useT();
  const { showDrives } = useSettings();
  return (
    <SplitPane
      direction="row"
      sized="first"
      storageKey="sizeatlas.split.left"
      defaultSize={340}
      label={t("split.left")}
      first={
        <SplitPane
          direction="column"
          sized="second"
          storageKey="sizeatlas.split.drives"
          defaultSize={170}
          label={t("split.drives")}
          first={tree}
          second={drives}
          collapse={showDrives ? undefined : "second"}
        />
      }
      second={content}
    />
  );
}

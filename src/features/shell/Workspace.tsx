import type { ReactNode } from "react";
import { useT } from "../../i18n/react";
import { useSettings } from "../../settings/react";
import { SplitPane } from "./SplitPane";

interface Props {
  tree: ReactNode;
  drives: ReactNode;
  content: ReactNode;
  /** Width the drives panel needs to show its columns in full (see DrivesPanel `onWidth`). */
  drivesWidth: number;
}

/** Default width of the left pane, unless the drives need more. */
const LEFT_WIDTH = 340;
/** The pane's border and rounding: the drives table must not scroll at exactly its width. */
const LEFT_SLACK = 2;

/**
 * Window body: the folder tree above the drives on the left (View › Drives panel hides them), the
 * content on the right.
 */
export function Workspace({ tree, drives, content, drivesWidth }: Props) {
  const { t } = useT();
  const { showDrives } = useSettings();
  return (
    <SplitPane
      direction="row"
      sized="first"
      storageKey="sizeatlas.split.left"
      // Until the border is moved, the pane is as wide as the drives need in this language.
      defaultSize={showDrives ? Math.max(LEFT_WIDTH, drivesWidth + LEFT_SLACK) : LEFT_WIDTH}
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

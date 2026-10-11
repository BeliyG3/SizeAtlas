import { usePalette } from "../../settings/react";
import { Icon } from "../icons/Icon";
import { CATEGORY_ICONS } from "../icons/paths";

interface Props {
  isDir: boolean;
  /** File category: picks the icon of a file and its color, that of the "File types" chart. */
  category: number;
}

/** A folder or file icon; decorative. */
export function ItemIcon({ isDir, category }: Props) {
  const palette = usePalette();
  if (isDir) return <Icon name="folder" className="folder-icon" />;
  return (
    <Icon
      name={CATEGORY_ICONS[category] ?? "file"}
      color={palette.categories[category] ?? palette.other}
    />
  );
}

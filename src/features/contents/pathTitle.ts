import type { Item, ListItem } from "../../api/types";
import { isolate } from "../../i18n";
import { itemPath } from "../export/names";

/**
 * Tooltip of a Path cell: the full path of the item, as the export writes it. `folderPath`: the
 * listed folder (empty while unknown). Isolated, so a right-to-left language does not reorder it.
 */
export function pathTitle(
  folderPath: string,
  item: Item | ListItem | undefined,
  lang: string,
): string | undefined {
  return folderPath && item ? isolate(itemPath(folderPath, item), lang) : undefined;
}

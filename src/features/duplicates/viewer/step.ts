import type { DupGroup } from "../../../api/duplicates";
import { mimeOf } from "../thumbs";

const isPicture = (g: DupGroup) => mimeOf(g.name) !== null;

/** The next group after `at` in `dir` whose name is a picture type; null at the end (no wrap). */
export function stepPicture(groups: readonly DupGroup[], at: number, dir: -1 | 1): number | null {
  for (let i = at + dir; i >= 0 && i < groups.length; i += dir) {
    if (isPicture(groups[i])) return i;
  }
  return null;
}

/** "N of M" of the group at `at` among the groups whose name is a picture type. */
export function picturePosition(groups: readonly DupGroup[], at: number) {
  let position = 0;
  let total = 0;
  groups.forEach((g, i) => {
    if (!isPicture(g)) return;
    total++;
    if (i <= at) position++;
  });
  return { position, total };
}

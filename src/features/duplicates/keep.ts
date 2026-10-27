import type { DupGroup } from "../../api/duplicates";
import type { Mode } from "../lists/modes";

/**
 * Whether the copies at the indices `marked` may go to the trash: each one can, and a copy that
 * can be kept (not in a system folder, its file id known) stays. The backend checks it again.
 */
export function canTrash(group: DupGroup, marked: ReadonlySet<number>): boolean {
  if (marked.size === 0) return false;
  const all = group.copies.every((c, i) => !marked.has(i) || c.trashable);
  return all && group.copies.some((c, i) => !marked.has(i) && !c.protected && !c.noId);
}

/**
 * The key of the copy marks of `group` in the result of `job`: a group of other copies, even
 * with the same hash after a copy left it, starts without marks (an index never means another
 * copy).
 */
export const copyMarksKey = (job: number, group: DupGroup) =>
  "dup:" +
  job +
  ":" +
  group.key +
  ":" +
  group.copies.map((c) => `${c.refs[0].root}|${c.refs[0].generation}|${c.refs[0].id}`).join(",");

/** Why a copy is never removed here, in the order the reasons are told. */
const HELD = ["protected", "noId", "hardlink"] as const;

/**
 * Why the copies at `marked` cannot go to the trash now, as a text key; null when they can.
 * `running`: a search runs. `removing`: a request has one of them already. A group marked out of
 * date gives none.
 */
export function copyTrashNote(
  group: DupGroup,
  marked: ReadonlySet<number>,
  running: boolean,
  removing: boolean,
): string | null {
  if (running) return "dup.searching";
  // A copy no longer matched: the backend refuses every copy of the group (`StaleId`).
  if (group.stale) return "dup.groupStale";
  const held = group.copies.find((c, i) => marked.has(i) && !c.trashable);
  const why = held && HELD.find((m) => held[m]);
  if (why) return `dup.${why}`;
  if (!canTrash(group, marked)) return "dup.lastCopy";
  return removing ? "trash.already" : null;
}

/**
 * What Delete outside the tables and Scan › Move to the trash do in `mode`: in the duplicates
 * mode only their own trash (the tree's selection is hidden there, and the usual trash would not
 * keep a copy), elsewhere the usual one.
 */
export const menuTrashFor = <T>(mode: Mode, regular: T, dup: T): T =>
  mode === "duplicates" ? dup : regular;

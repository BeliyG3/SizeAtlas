import type { TrashPreview, TrashProgress, TrashResult } from "../../api/types";
import type { Params } from "../../i18n";

/** Failures a report names; the others are left at "…". */
const NAMED_FAILURES = 3;

type Translate = (key: string, params?: Params) => string;
/** A count as the language writes it (`formatCount`). */
type Count = (n: number) => string;
type Size = (bytes: number) => string;

/**
 * How a request removes its items: to the trash, to the trash from a clean-up list (the backend
 * checks the rows again; the bin's space matters), or for good (clean-up lists only).
 */
export type Removal = "trash" | "cleanup" | "purge";

/** The full paths the preview lists, how many more items go, their total size and when they were scanned. */
function previewLines(
  preview: TrashPreview,
  t: Translate,
  size: Size,
  date: (seconds: number) => string,
  count: Count,
): string[] {
  const lines = [...preview.paths];
  const more = preview.count - preview.paths.length;
  if (more > 0) lines.push(t("trash.more", { count: more, items: count(more) }));
  lines.push(t("trash.summary", { size: size(preview.size), date: date(preview.scannedAt) }));
  return lines;
}

/**
 * The confirmation of a trash request, one line each: the question and the preview. From a
 * clean-up list (`cleanup`) also when the space comes back, and that the bin drops its oldest
 * files when the items do not fit in its free space (known on Windows only).
 */
export function trashMessage(
  preview: TrashPreview,
  t: Translate,
  size: Size,
  date: (seconds: number) => string,
  count: Count,
  cleanup = false,
): string {
  const lines = [t("trash.ask", { count: preview.count, items: count(preview.count) })];
  lines.push(...previewLines(preview, t, size, date, count));
  if (cleanup) {
    lines.push(t("trash.freedLater"));
    const free = preview.binFree;
    // As the bin check counts it: the larger of the size on disk and the length, per item.
    if (free !== null && preview.binSize > free)
      lines.push(t("trash.binFull", { free: size(free) }));
  }
  return lines.join("\n");
}

/** The first question before deleting for good: the preview, and that it cannot be undone. */
export function purgeMessage(
  preview: TrashPreview,
  t: Translate,
  size: Size,
  date: (seconds: number) => string,
  count: Count,
): string {
  const lines = [t("purge.ask"), ...previewLines(preview, t, size, date, count)];
  lines.push(t("purge.cannotUndo"));
  return lines.join("\n");
}

/** The second question before deleting for good: how many items, how large. */
export const purgeAgain = (preview: TrashPreview, t: Translate, size: Size, count: Count) =>
  t("purge.askAgain", {
    count: preview.count,
    items: count(preview.count),
    size: size(preview.size),
  });

/** The last part of a path: the name of the item. */
export const itemName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** "Moving to the trash: 3 of 120" (`purge`: "Deleting permanently: …"): the item that goes now among all. */
export function trashProgressText(
  progress: Omit<TrashProgress, "request">,
  t: Translate,
  count: Count,
  purge = false,
): string {
  const at = progress.current === null ? progress.done : progress.done + 1;
  const key = purge ? "purge.progress" : "trash.progress";
  return t(key, { done: count(at), total: count(progress.total) });
}

/** How full the bar of `progress` is: by items, or by bytes while the copy that stays is read. */
export function progressBar(progress: Omit<TrashProgress, "request">) {
  const [value, max] = progress.rehash ?? [progress.done, progress.total];
  return { max: Math.max(1, max), value: Math.min(value, max) };
}

/**
 * Messages after a request of `preview` that removed its items `how`: what went (its size from
 * the result), where a stop left it, what stayed and why, what was gone already, and a change
 * that was not saved. A request that never started has no messages.
 */
export function trashReport(
  result: TrashResult,
  preview: TrashPreview,
  t: Translate,
  errorText: (e: unknown) => string,
  count: Count,
  size: Size,
  how: Removal = "trash",
): string[] {
  // Never started: nothing was tried, nothing to say.
  if (result.cancelled) return [];
  const purge = how === "purge";
  const keys = purge ? "purge" : "trash";
  // The count of what went, under the name its texts give it.
  const went = (n: number) => ({ [purge ? "deleted" : "moved"]: count(n) });
  const messages: string[] = [];
  const named = result.failed.slice(0, NAMED_FAILURES).map(({ path, error }) => {
    // The path is named already: say only why.
    const why =
      error.code === "Io"
        ? error.osMessage
        : error.code === "NoAccess"
          ? t("trash.noAccess")
          : errorText(error);
    return `${path}: ${why}`;
  });
  if (result.failed.length > NAMED_FAILURES) named.push("…");
  const failures = named.join("; ");
  if (result.stopped) {
    const total = preview.count;
    messages.push(
      t(`${keys}.stopped`, { count: total, ...went(result.removed), total: count(total) }),
    );
    if (failures) messages.push(t(`${keys}.failed`, { failures }));
  } else if (failures) {
    const total = result.removed + result.failed.length;
    messages.push(
      result.removed === 0
        ? t(`${keys}.failed`, { failures })
        : t(`${keys}.partial`, { ...went(result.removed), total: count(total), failures }),
    );
  } else if (result.removed > 0 && how !== "trash") {
    // What a clean-up is for: the space, and whether it is free yet.
    messages.push(t(purge ? "purge.done" : "trash.doneCleanup", { size: size(result.size) }));
  } else if (result.removed === 1 && preview.paths.length === 1) {
    messages.push(t("trash.doneOne", { name: itemName(preview.paths[0]) }));
  } else if (result.removed > 0) {
    const items = count(result.removed);
    messages.push(t("trash.done", { count: result.removed, items, size: size(result.size) }));
  }
  if (result.gone > 0)
    messages.push(t("trash.gone", { count: result.gone, items: count(result.gone) }));
  if (result.warning) messages.push(errorText(result.warning));
  return messages;
}

/** "Cancelled 2 queued removals.": what Stop of a request took off the queue of its volume. */
export const cancelledText = (cancelled: number, t: Translate, count: Count) =>
  t("trash.cancelledQueued", { count: cancelled, items: count(cancelled) });

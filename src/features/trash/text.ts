import type { TrashPreview, TrashProgress, TrashResult } from "../../api/types";
import type { Params } from "../../i18n";

/** Failures a report names; the others are left at "…". */
const NAMED_FAILURES = 3;

type Translate = (key: string, params?: Params) => string;
/** A count as the language writes it (`formatCount`). */
type Count = (n: number) => string;

/**
 * The confirmation of a trash request, one line each: the question, the full paths the preview
 * lists, how many more items go, their total size and when they were scanned.
 */
export function trashMessage(
  preview: TrashPreview,
  t: Translate,
  size: (bytes: number) => string,
  date: (seconds: number) => string,
  count: Count,
): string {
  const lines = [t("trash.ask", { count: preview.count, items: count(preview.count) })];
  lines.push(...preview.paths);
  const more = preview.count - preview.paths.length;
  if (more > 0) lines.push(t("trash.more", { count: more, items: count(more) }));
  lines.push(t("trash.summary", { size: size(preview.size), date: date(preview.scannedAt) }));
  return lines.join("\n");
}

/** The last part of a path: the name of the item. */
export const itemName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** "Moving to the trash: 3 of 120": the item that goes now among all of them. */
export function trashProgressText(progress: TrashProgress, t: Translate, count: Count): string {
  const at = progress.current === null ? progress.done : progress.done + 1;
  return t("trash.progress", { done: count(at), total: count(progress.total) });
}

/**
 * Messages after a trash request of `preview`: what moved (its size from the preview), where a
 * stop left it, what stayed and why, and a change that was not saved.
 */
export function trashReport(
  result: TrashResult,
  preview: TrashPreview,
  t: Translate,
  errorText: (e: unknown) => string,
  count: Count,
  size: (bytes: number) => string,
): string[] {
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
      t("trash.stopped", { count: total, moved: count(result.removed), total: count(total) }),
    );
    if (failures) messages.push(t("trash.failed", { failures }));
  } else if (failures) {
    const total = result.removed + result.failed.length;
    messages.push(
      result.removed === 0
        ? t("trash.failed", { failures })
        : t("trash.partial", { moved: count(result.removed), total: count(total), failures }),
    );
  } else if (result.removed === 1 && preview.paths.length === 1) {
    messages.push(t("trash.doneOne", { name: itemName(preview.paths[0]) }));
  } else if (result.removed > 0) {
    const items = count(result.removed);
    messages.push(t("trash.done", { count: result.removed, items, size: size(preview.size) }));
  }
  if (result.warning) messages.push(errorText(result.warning));
  return messages;
}

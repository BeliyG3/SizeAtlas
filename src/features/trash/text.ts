import type { TrashPreview, TrashResult } from "../../api/types";
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

/** Messages after a trash request: what stayed and why, and a change that was not saved. */
export function trashReport(
  result: TrashResult,
  t: Translate,
  errorText: (e: unknown) => string,
  count: Count,
): string[] {
  const messages: string[] = [];
  if (result.failed.length > 0) {
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
    const total = result.removed + result.failed.length;
    messages.push(
      result.removed === 0
        ? t("trash.failed", { failures })
        : t("trash.partial", { moved: count(result.removed), total: count(total), failures }),
    );
  }
  if (result.warning) messages.push(errorText(result.warning));
  return messages;
}

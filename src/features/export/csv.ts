import type { Detail, Item, ListItem, ReasonDto } from "../../api/types";
import type { ColumnId } from "../contents/columns";

/** "," for CSV, ";" for Excel with Russian or other European regional settings. */
export type Separator = "," | ";";

export const parseSeparator = (raw: string | null): Separator => (raw === ";" ? ";" : ",");

/** RFC 4180: a field with the separator, a quote, CR or LF is quoted, its quotes doubled. */
export function csvField(value: string, separator: Separator): string {
  const quoted = value.includes(separator) || /["\r\n]/.test(value);
  return quoted ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A share (0.3694) as a percentage with up to two decimals and a dot: "36.94". */
export const csvPercent = (share: number): string => String(Number((share * 100).toFixed(2)));

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD HH:MM:SS" of milliseconds since the Unix epoch; empty when unknown. */
export function csvDate(ms: number | null): string {
  if (ms === null || ms === 0 || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A change in signed bytes ("+200", "-40", "0"); a new item grows by its size; empty if unknown. */
function csvChange(item: Item | ListItem): string {
  const { change } = item;
  if (change === null || change === "unknown") return "";
  const delta = change === "new" ? item.size : change.delta;
  return delta > 0 ? `+${delta}` : String(delta);
}

/** The words of a reason in the language of the app; without them the CSV carries the code of the reason. */
export type ReasonWords = (reason: ReasonDto) => string;

/** The value of a table cell (see ContentsRow) without units or separators; empty if not applicable. */
export function cellValue(
  column: ColumnId,
  item: Item | ListItem,
  detail: Detail | undefined,
  folderSize: number,
  reasonWords: ReasonWords = (reason) => reason.reason,
): string {
  if (item.pending) {
    if (["len", "folders", "dirs"].includes(column)) return "";
    if (!item.scanning && ["size", "percent", "change", "files"].includes(column)) return "";
  }
  const count = (n: number) => (item.isDir ? String(n) : "");
  switch (column) {
    case "name":
      return item.name;
    case "path":
      return "folder" in item ? item.folder : "";
    case "len":
      return String(item.len);
    case "size":
      return String(item.size);
    case "percent":
      return csvPercent(folderSize > 0 ? item.size / folderSize : 0);
    case "reason": {
      const reason = "reason" in item ? item.reason : null;
      return reason ? reasonWords(reason) : "";
    }
    case "before":
      return item.before === null ? "" : String(item.before);
    case "change":
      return csvChange(item);
    case "files":
      return count(item.files);
    case "folders":
      return count(item.folders);
    case "dirs":
      return count(item.dirs);
    case "created":
      return csvDate(detail?.created ?? null);
    case "modified":
      return csvDate(item.modified);
    case "accessed":
      return csvDate(detail?.accessed ?? null);
    case "attributes":
      return detail?.attributes ?? "";
    case "owner":
      return detail?.owner ?? "";
  }
}

export interface CsvTable {
  /** The full path's label, then one per column. */
  header: readonly string[];
  columns: readonly ColumnId[];
  items: readonly (Item | ListItem)[];
  details: ReadonlyMap<number, Detail>;
  /** Size on disk of the listed folder: the base of the percentages. */
  folderSize: number;
  pathOf: (item: Item | ListItem) => string;
  /** The words of the "reason" column; see `ReasonWords`. */
  reasonWords?: ReasonWords;
}

/** The table as CSV: the header, then a line per item with its full path first; CRLF line ends. */
export function tableCsv(table: CsvTable, separator: Separator): string {
  const line = (fields: readonly string[]) =>
    fields.map((f) => csvField(f, separator)).join(separator) + "\r\n";
  const lines = [line(table.header)];
  for (const item of table.items) {
    const detail = table.details.get(item.id);
    const cells = table.columns.map((c) =>
      cellValue(c, item, detail, table.folderSize, table.reasonWords),
    );
    lines.push(line([table.pathOf(item), ...cells]));
  }
  return lines.join("");
}

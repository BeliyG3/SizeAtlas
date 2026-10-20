/** Joins path parts with the separator the first one (a root path) uses; empty parts are skipped. */
export function joinPath(parts: readonly string[]): string {
  const separator = parts[0]?.includes("\\") ? "\\" : "/";
  return parts.reduce((path, part) => {
    if (part === "") return path;
    if (path === "" || path.endsWith("\\") || path.endsWith("/")) return path + part;
    return path + separator + part;
  }, "");
}

/** Characters Windows refuses in file names, control characters among them. */
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;

/** "SizeAtlas - <name> - <YYYY-MM-DD>.csv"; a root path gives its last part. */
export function exportFileName(name: string, day: Date): string {
  const last = name.split(/[\\/]/).filter(Boolean).pop() ?? "";
  // Windows drops trailing dots and spaces itself.
  const clean = last
    .replace(INVALID, "")
    .replace(/[. ]+$/, "")
    .trim();
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, "0")}`;
  return clean === "" ? `SizeAtlas - ${date}.csv` : `SizeAtlas - ${clean} - ${date}.csv`;
}

/** The full path of an item of a table: the listed folder, the item's folder in it (lists), its name. */
export function itemPath(folderPath: string, item: { name: string; folder?: string }): string {
  return joinPath([folderPath, item.folder ?? "", item.name]);
}

/** The path a chain of crumbs (root first) leads to. */
export const crumbsPath = (crumbs: readonly { name: string }[]): string =>
  joinPath(crumbs.map((c) => c.name));

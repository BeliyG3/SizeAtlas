/** Calendar version `YEAR.MONTH.N` as shown to people: the first release of a month (`N` = 0) reads `YEAR.MONTH`. */
export function displayVersion(version: string): string {
  return version.endsWith(".0") && version.split(".").length === 3 ? version.slice(0, -2) : version;
}

/** MSI version of a calendar version: `YY.MM.N`, because Windows Installer allows at most 255 in the first number. */
export function wixVersion(version: string): string {
  return version.slice(2);
}

/** `YEAR.MONTH` or `YEAR.MONTH.N` as numbers (`2026.10` is `2026.10.0`); null for anything else. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?$/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Whether calendar version `candidate` comes after `current`; false when either cannot be read. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const at = a.findIndex((n, i) => n !== b[i]);
  return at >= 0 && a[at] > b[at];
}

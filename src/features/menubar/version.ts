/** Calendar version `YEAR.MONTH.N` as shown to people: the first release of a month (`N` = 0) reads `YEAR.MONTH`. */
export function displayVersion(version: string): string {
  return version.endsWith(".0") && version.split(".").length === 3 ? version.slice(0, -2) : version;
}

/** MSI version of a calendar version: `YY.MM.N`, because Windows Installer allows at most 255 in the first number. */
export function wixVersion(version: string): string {
  return version.slice(2);
}

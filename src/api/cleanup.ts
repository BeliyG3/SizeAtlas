// What the backend sends for the two clean-up lists (see `ListItem.reason`, `List.cleanup`).

/** Why a clean-up row is listed (the core's `Reason`). */
export type ReasonKind =
  | "tempOld"
  | "tempLarge"
  | "tempWork"
  | "crashDump"
  | "crashDumpRecent"
  | "errorReport"
  | "windowsCache"
  | "shaderCache"
  | "browserCache"
  | "appCache"
  | "packageCache"
  | "pythonBytecode"
  | "nodeModules"
  | "pythonVenv"
  | "gradleCache"
  | "discordCache"
  | "xcodeDerived";

/** The reason of a row of "cleanup" and "review". */
export interface ReasonDto {
  reason: ReasonKind;
  /** The tool's own clean-up command, for the user to run. */
  command: string | null;
  /** `node_modules` and venvs: whether a lock file lies next to them; null for other rows. */
  restorable: boolean | null;
}

/** A fact shown under the total of the clean-up modes: not a row, never deleted. */
export type InfoKind =
  | "pagefile"
  | "hiberfil"
  | "previousWindows"
  | "windowsUpdate"
  | "deliveryOptimization"
  | "toolStore"
  | "noAccess"
  | "appRunning";

/** Which fields are set depends on `kind`; the others are null. */
export interface InfoDto {
  kind: InfoKind;
  path: string | null;
  /** Size on disk. */
  size: number | null;
  app: string | null;
  command: string | null;
}

export interface CleanupDto {
  info: InfoDto[];
  /** Something was read in part: the total is a lower bound. */
  approximate: boolean;
}

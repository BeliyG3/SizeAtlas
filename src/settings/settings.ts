/** `localStorage` keys. */
export const THEME_KEY = "sizeatlas.theme";
export const UNIT_KEY = "sizeatlas.unit";
/** Whether the drives panel and the chart area are shown: "0" hides them. */
export const DRIVES_KEY = "sizeatlas.view.drives";
export const CHART_KEY = "sizeatlas.view.chart";

export const THEMES = ["system", "dark", "light"] as const;
export type ThemePref = (typeof THEMES)[number];
export type Theme = "dark" | "light";

export const UNITS = ["auto", "B", "KB", "MB", "GB"] as const;
export type SizeUnit = (typeof UNITS)[number];

/** Larger stored pane sizes are garbage. */
const MAX_STORED_SIZE = 100_000;

export const parseTheme = (raw: string | null): ThemePref =>
  THEMES.find((t) => t === raw) ?? "system";

export const parseUnit = (raw: string | null): SizeUnit => UNITS.find((u) => u === raw) ?? "auto";

export const resolveTheme = (pref: ThemePref, systemDark: boolean): Theme =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

/** A stored size in pixels; anything unusable gives `fallback`. */
export function parseSize(raw: string | null, fallback: number): number {
  const value = raw === null || raw === "" ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 1 && value < MAX_STORED_SIZE
    ? Math.round(value)
    : fallback;
}

/** A panel is shown unless it was stored as hidden. */
export const parseShown = (raw: string | null): boolean => raw !== "0";
export const serializeShown = (shown: boolean): string => (shown ? "1" : "0");

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import { formatSize } from "../format";
import { useT } from "../i18n/react";
import { PALETTES, type Palette } from "../palette";
import {
  CHART_KEY,
  CITY_KEY,
  DRIVES_KEY,
  THEME_KEY,
  UNIT_KEY,
  parseShown,
  parseTheme,
  parseUnit,
  resolveTheme,
  serializeShown,
  type SizeUnit,
  type Theme,
  type ThemePref,
} from "./settings";
import { useStored } from "./storage";

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface Settings {
  theme: ThemePref;
  setTheme: (theme: ThemePref) => void;
  /** The theme in effect: "system" resolved through the OS setting. */
  resolved: Theme;
  unit: SizeUnit;
  setUnit: (unit: SizeUnit) => void;
  /** View › Drives panel. */
  showDrives: boolean;
  setShowDrives: (shown: boolean) => void;
  /** View › Chart. */
  showChart: boolean;
  setShowChart: (shown: boolean) => void;
  /** View › 3D city; off until turned on. */
  showCity: boolean;
  setShowCity: (shown: boolean) => void;
}

const SettingsContext = createContext<Settings | null>(null);

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemIsDark = () => window.matchMedia(DARK_QUERY).matches;
const parseCity = (raw: string | null) => parseShown(raw, false);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useStored(THEME_KEY, parseTheme);
  const [unit, setUnit] = useStored(UNIT_KEY, parseUnit);
  const [showDrives, setShowDrives] = useStored(DRIVES_KEY, parseShown, serializeShown);
  const [showChart, setShowChart] = useStored(CHART_KEY, parseShown, serializeShown);
  const [showCity, setShowCity] = useStored(CITY_KEY, parseCity, serializeShown);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemIsDark);
  const resolved = resolveTheme(theme, systemDark);
  // Before paint, so a light theme never flashes dark.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  // The window follows the chosen theme ("system" hands it back to the OS); then the title bar
  // is painted in the theme in effect, over the accent color Windows may give it.
  useEffect(() => {
    // A title bar in the other theme is acceptable.
    const paint = () => api.setTitleBar(resolved === "dark").catch(() => {});
    try {
      getCurrentWindow()
        .setTheme(theme === "system" ? null : theme)
        .then(paint, paint);
      // The startup frame is dark (tauri.conf.json); the window and webview behind the page
      // follow the theme from here on, so a light theme shows no dark edges when resized.
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (bg)
        getCurrentWebviewWindow()
          .setBackgroundColor(bg)
          .catch(() => {});
    } catch {
      // Not running inside Tauri: getCurrentWindow throws without its internals.
    }
  }, [theme, resolved]);
  const value = useMemo<Settings>(
    () => ({
      theme,
      setTheme,
      resolved,
      unit,
      setUnit,
      showDrives,
      setShowDrives,
      showChart,
      setShowChart,
      showCity,
      setShowCity,
    }),
    [
      theme,
      setTheme,
      resolved,
      unit,
      setUnit,
      showDrives,
      setShowDrives,
      showChart,
      setShowChart,
      showCity,
      setShowCity,
    ],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}

/** Formats sizes in the current language and size unit. */
export function useSize(): (bytes: number) => string {
  const { lang } = useT();
  const { unit } = useSettings();
  return useCallback((bytes: number) => formatSize(bytes, lang, unit), [lang, unit]);
}

/** Canvas and SVG colors of the current theme. */
export function usePalette(): Palette {
  return PALETTES[useSettings().resolved];
}

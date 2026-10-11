import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { I18nProvider } from "./i18n/react";
import { SettingsProvider } from "./settings/react";
import { THEME_KEY, parseTheme, resolveTheme } from "./settings/settings";
import { readStored } from "./settings/storage";
import "./styles/theme.css";

// The stored theme goes on before the first paint; SettingsProvider keeps it in sync after.
document.documentElement.dataset.theme = resolveTheme(
  parseTheme(readStored(THEME_KEY)),
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </I18nProvider>
  </StrictMode>,
);

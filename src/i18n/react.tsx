import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LANGUAGES, detectLang, isRtl, translate, type Lang, type Params } from "./index";

const STORAGE_KEY = "sizeatlas.lang";

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Params) => string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const known = LANGUAGES.find((l) => l.code === saved);
    if (known) return known.code;
  } catch {
    // Storage can be unavailable; fall back to the system language.
  }
  return detectLang(navigator.languages);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembering the choice is acceptable.
    }
  }, []);
  // Screen readers and spell checking use the document language; the direction follows the script.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, params) => translate(lang, key, params) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT must be used inside I18nProvider");
  return value;
}

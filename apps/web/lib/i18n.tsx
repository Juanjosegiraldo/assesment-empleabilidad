"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

export type Locale = "es" | "en";

/**
 * Both catalogues are typed against the Spanish one, so adding a key to es.json without
 * adding it to en.json is a compile error rather than a missing string a user finds.
 */
type Catalogue = typeof es;
const CATALOGUES: Record<Locale, Catalogue> = { es, en };

type Translate = (key: keyof Catalogue, values?: Record<string, string | number>) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = "rw_locale";

export function I18nProvider({
  initialLocale = "es",
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Read the saved preference after mount, never during render: the server has no
  // localStorage, and reading it while rendering would produce different markup on the
  // two sides and trigger a hydration mismatch.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "es" || saved === "en") setLocaleState(saved);
    } catch {
      // Private mode, or storage disabled. The default locale is a fine fallback.
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not worth failing the interaction over.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, values) => {
      const template = CATALOGUES[locale][key] ?? key;
      if (!values) return template;
      // Minimal interpolation: {count} style placeholders. A full ICU formatter would be
      // a dependency for pluralisation this interface does not have.
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

/** Shorthand for components that only need to translate. */
export const useT = (): Translate => useI18n().t;

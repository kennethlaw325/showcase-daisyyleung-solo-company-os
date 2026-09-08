"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/src/lib/i18n/locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  localeError: string;
  localeSaving: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = "solo-company-os-locale";

export function LocaleProvider({ children, initialLocale = DEFAULT_LOCALE, persist = false, demo = false }: { children: ReactNode; initialLocale?: Locale; persist?: boolean; demo?: boolean }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [localeError, setLocaleError] = useState("");
  const [localeSaving, setLocaleSaving] = useState(false);

  useEffect(() => {
    if (persist) {
      document.documentElement.lang = initialLocale;
      return;
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh-Hant") {
      document.documentElement.lang = saved;
      const update = window.setTimeout(() => setLocaleState(saved), 0);
      return () => window.clearTimeout(update);
    }
  }, [initialLocale, persist]);

  const value = useMemo<LocaleContextValue>(() => {
    const setLocale = (nextLocale: Locale) => {
      if (nextLocale === locale || localeSaving) return;
      setLocaleError("");
      if (!persist || demo) {
        setLocaleState(nextLocale);
        document.documentElement.lang = nextLocale;
        window.localStorage.setItem(STORAGE_KEY, nextLocale);
        if (demo) {
          document.cookie = `${STORAGE_KEY}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
          router.refresh();
        }
        return;
      }
      setLocaleSaving(true);
      void fetch("/api/profile/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "Unable to save language preference");
          }
          setLocaleState(nextLocale);
          document.documentElement.lang = nextLocale;
          window.localStorage.setItem(STORAGE_KEY, nextLocale);
          router.refresh();
        })
        .catch(() => {
          setLocaleError(nextLocale === "zh-Hant" ? "語言偏好未能儲存，已維持原有語言。" : "Your language preference could not be saved; the previous language remains active.");
        })
        .finally(() => setLocaleSaving(false));
    };

    return {
      locale,
      setLocale,
      toggleLocale: () => setLocale(locale === "zh-Hant" ? "en" : "zh-Hant"),
      localeError,
      localeSaving,
    };
  }, [demo, locale, localeError, localeSaving, persist, router]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}

export function Localized({ zh, en }: { zh: ReactNode; en: ReactNode }) {
  const { locale } = useLocale();
  return <>{locale === "zh-Hant" ? zh : en}</>;
}

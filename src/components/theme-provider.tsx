"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const STORAGE_KEY = "solo-company-os-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    const initialTheme: Theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
    applyTheme(initialTheme);

    const frame = window.requestAnimationFrame(() => setTheme(initialTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    toggleTheme: () => {
      setTheme((currentTheme) => {
        const nextTheme = currentTheme === "dark" ? "light" : "dark";
        window.localStorage.setItem(STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
        return nextTheme;
      });
    },
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}

export function ThemeToggle({ language = "en", compact = false }: { language?: "zh" | "en"; compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = language === "zh"
    ? isDark ? "切換至亮色模式" : "切換至暗色模式"
    : isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button className={`theme-toggle ${compact ? "is-compact" : ""}`} type="button" onClick={toggleTheme} aria-label={label} title={label}>
      <span aria-hidden="true">{isDark ? "☼" : "☾"}</span>
      {compact ? <span className="visually-hidden">{label}</span> : <span>{language === "zh" ? isDark ? "亮色" : "暗色" : isDark ? "Light" : "Dark"}</span>}
    </button>
  );
}

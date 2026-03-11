"use client";

import { useSyncExternalStore } from "react";

type ThemeName = "light" | "dark";

const STORAGE_KEY = "lp-theme";
const DEFAULT_THEME: ThemeName = "light";

let themeState: ThemeName = DEFAULT_THEME;
let initialized = false;
const listeners = new Set<() => void>();

const getPreferredTheme = (): ThemeName => {
  if (typeof window === "undefined") return DEFAULT_THEME;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const applyTheme = (theme: ThemeName) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty("color-scheme", theme);
};

const setThemeState = (next: ThemeName) => {
  themeState = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  applyTheme(next);
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  // Lazy init on the client after hydration begins to avoid SSR mismatches.
  if (!initialized && typeof window !== "undefined") {
    initialized = true;
    const preferred = getPreferredTheme();
    if (preferred !== themeState) {
      setThemeState(preferred);
    } else {
      applyTheme(themeState);
    }
  }

  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => themeState;
const getServerSnapshot = () => DEFAULT_THEME;

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setThemeState(next);
  };

  const label =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={theme === "dark"}
      className="fixed right-6 top-6 z-50 flex items-center gap-3 rounded-lg bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-1 ring-inset ring-border/70 transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={label}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground shadow-sm">
        {theme === "dark" ? <MoonIcon /> : <SunIcon />}
      </span>
      <span className="leading-snug">
        {theme === "dark" ? "Dark" : "Light"} mode
        <span className="block text-xs text-muted-foreground">Tap to toggle</span>
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.7"
    >
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.7"
    >
      <path d="M20.5 13.6A8.5 8.5 0 0 1 10.4 3.5a7.1 7.1 0 1 0 9.8 10.1Z" />
    </svg>
  );
}

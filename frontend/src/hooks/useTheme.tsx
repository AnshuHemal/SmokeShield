import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "smokeshield.theme";
const META_COLOR: Record<ResolvedTheme, string> = { dark: "#0a0b0f", light: "#f3f4f7" };

interface ThemeContextValue {
  /** What the user picked (may be "system"). */
  preference: ThemePreference;
  /** What is actually showing right now. */
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  /** Cycles light → dark → system, for single-button toggles. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system"; // storage blocked (private mode etc.)
  }
}

const resolve = (p: ThemePreference): ResolvedTheme => (p === "system" ? (systemDark() ? "dark" : "light") : p);

function apply(theme: ResolvedTheme, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 300);
  }
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPreference()));

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    try {
      p === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, p);
    } catch {
      /* the choice still applies for this session */
    }
  }, []);

  // Apply whenever the preference changes, and follow the OS while it is "system".
  useEffect(() => {
    const update = (animate: boolean) => {
      const next = resolve(preference);
      setResolved(next);
      apply(next, animate);
    };
    update(true);
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => update(true);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setPref(readPreference());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const cycle = useCallback(() => {
    setPreference(preference === "light" ? "dark" : preference === "dark" ? "system" : "light");
  }, [preference, setPreference]);

  const value = useMemo(() => ({ preference, resolved, setPreference, cycle }), [preference, resolved, setPreference, cycle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark";
export type DensityMode = "comfortable" | "compact";

export const THEME_STORAGE_KEY = "ksp_theme";
export const DENSITY_STORAGE_KEY = "ksp_density";

export interface ThemeContextValue {
  theme: ThemeMode;
  density: DensityMode;
  isDark: boolean;
  isCompact: boolean;
  setTheme: (next: ThemeMode) => void;
  toggleTheme: () => void;
  setDensity: (next: DensityMode) => void;
  toggleDensity: () => void;
}

export interface ThemeProviderProps {
  children: ReactNode;
}

function parseTheme(value: string | null | undefined): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

function parseDensity(value: string | null | undefined): DensityMode {
  return value === "compact" ? "compact" : "comfortable";
}

function readInitialTheme(): ThemeMode {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // Ignore storage errors (private browsing / restricted environments)
    }
  }
  if (typeof document !== "undefined") {
    return parseTheme(document.documentElement.dataset.theme);
  }
  return "light";
}

function readInitialDensity(): DensityMode {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
      if (stored === "comfortable" || stored === "compact") return stored;
    } catch {
      // Ignore storage errors
    }
  }
  if (typeof document !== "undefined") {
    return parseDensity(document.documentElement.dataset.density);
  }
  return "comfortable";
}

function syncThemeToDomAndStorage(theme: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
  }
}

function syncDensityToDomAndStorage(density: DensityMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.density = density;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // Ignore storage write errors
    }
  }
}

const noop = () => {};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  density: "comfortable",
  isDark: false,
  isCompact: false,
  setTheme: noop,
  toggleTheme: noop,
  setDensity: noop,
  toggleDensity: noop,
});

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);
  const [density, setDensityState] = useState<DensityMode>(readInitialDensity);

  useEffect(() => {
    syncThemeToDomAndStorage(theme);
  }, [theme]);

  useEffect(() => {
    syncDensityToDomAndStorage(density);
  }, [density]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === THEME_STORAGE_KEY) {
        const next = parseTheme(ev.newValue);
        setThemeState(next);
        if (typeof document !== "undefined") {
          document.documentElement.dataset.theme = next;
        }
      } else if (ev.key === DENSITY_STORAGE_KEY) {
        const next = parseDensity(ev.newValue);
        setDensityState(next);
        if (typeof document !== "undefined") {
          document.documentElement.dataset.density = next;
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    syncThemeToDomAndStorage(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      syncThemeToDomAndStorage(next);
      return next;
    });
  }, []);

  const setDensity = useCallback((next: DensityMode) => {
    syncDensityToDomAndStorage(next);
    setDensityState(next);
  }, []);

  const toggleDensity = useCallback(() => {
    setDensityState((prev) => {
      const next: DensityMode = prev === "compact" ? "comfortable" : "compact";
      syncDensityToDomAndStorage(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      density,
      isDark: theme === "dark",
      isCompact: density === "compact",
      setTheme,
      toggleTheme,
      setDensity,
      toggleDensity,
    }),
    [theme, density, setTheme, toggleTheme, setDensity, toggleDensity],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

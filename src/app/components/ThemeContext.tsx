// FORMLESS — Theme context
// Manages theme-dark / theme-light class on document.documentElement
// All color values come from CSS custom properties in theme.css

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface ThemeContextValue {
  isDark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

function setThemeClass(theme: 'dark' | 'light') {
  document.documentElement.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.add(`theme-${theme}`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  // Apply theme class to <html> on mount and on every toggle
  useEffect(() => {
    setThemeClass(isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggle = useCallback(() => setIsDark(d => !d), []);

  return (
    <ThemeContext.Provider value={{ isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

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

function getSystemPreference(): boolean {
  if (typeof window === 'undefined') return true;
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

const DARK_BG = '#0A0A0B';
const LIGHT_BG = '#FDFDFD';

function getOrCreateMeta(name: string): HTMLMetaElement {
  let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  return meta;
}

function updateThemeColor(isDark: boolean) {
  const color = isDark ? DARK_BG : LIGHT_BG;
  getOrCreateMeta('theme-color').content = color;
  // iOS Safari standalone / PWA status bar
  getOrCreateMeta('apple-mobile-web-app-capable').content = 'yes';
  getOrCreateMeta('apple-mobile-web-app-status-bar-style').content = isDark ? 'black-translucent' : 'default';
}

// Set immediately on module load (before React renders) so Safari picks it up ASAP
updateThemeColor(getSystemPreference());

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(getSystemPreference);

  // Apply theme class + Safari theme-color on mount and on every toggle
  useEffect(() => {
    setThemeClass(isDark ? 'dark' : 'light');
    updateThemeColor(isDark);
  }, [isDark]);

  // Listen for system theme changes (e.g. user switches OS dark/light mode)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggle = useCallback(() => setIsDark(d => !d), []);

  return (
    <ThemeContext.Provider value={{ isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
import {useCallback, useEffect, useState} from 'react';

export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'deepbench-studio-theme';

export function getInitialTheme(): Theme {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* storage unavailable */ }
  try {
    if (globalThis.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch { /* matchMedia unavailable */ }
  return 'dark';
}

export function useTheme(): [Theme, () => void, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  useEffect(() => {
    try {globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);} catch { /* ignore */ }
  }, [theme]);
  const toggle = useCallback(() => setThemeState(current => current === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle, setThemeState];
}

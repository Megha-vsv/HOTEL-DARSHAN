import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

// Mirrors the existing LanguageContext pattern: the customer picks a preference
// and it is stored per device, so it survives refresh, navigation and logout.
const CUSTOMER_STORAGE_KEY = 'hotel_darshan_theme';

// The admin surface keeps its own preference and its own document attribute so
// choosing an admin theme can never alter what the customer, kitchen or rider
// see.
export const ADMIN_STORAGE_KEY = 'hotel_darshan_admin_theme';
export const ADMIN_THEME_ATTRIBUTE = 'data-hd-admin-theme';

const THEMES = ['light', 'dark', 'system'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredTheme(storageKey) {
  try {
    const saved = localStorage.getItem(storageKey);
    return THEMES.includes(saved) ? saved : 'light';
  } catch {
    return 'light';
  }
}

function readSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function ThemeProvider({ children, storageKey = CUSTOMER_STORAGE_KEY, attribute = 'data-hd-theme', applyToDocument = true }) {
  // Hotel Darshan keeps its existing light appearance as the default.
  const [theme, setThemeState] = useState(() => readStoredTheme(storageKey));
  const [systemTheme, setSystemTheme] = useState(readSystemTheme);

  // Keep following the device preference while "System default" is selected.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = (event) => setSystemTheme(event.matches ? 'dark' : 'light');

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  // Reflect the active theme on <html> so the whole customer surface, including
  // body-level backgrounds, switches in a single paint. The attribute is removed
  // on unmount so the staff/admin portals keep their own untouched appearance.
  // Staff surfaces opt out (applyToDocument = false) and instead put the
  // attribute on their own root element, which scopes the identical dark palette
  // to just that subtree.
  useEffect(() => {
    if (!applyToDocument) return undefined;

    const root = document.documentElement;
    root.setAttribute(attribute, resolvedTheme);
    root.style.colorScheme = resolvedTheme;

    return () => {
      root.removeAttribute(attribute);
      root.style.colorScheme = '';
    };
  }, [resolvedTheme, applyToDocument, attribute]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Preference simply stays active for this session if storage is unavailable.
    }
  }, [storageKey]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, systemTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Admin variant: same light/dark/system behaviour and the same existing dark
// palette, but stored separately and applied to the admin subtree only, so the
// customer, kitchen and rider surfaces are completely unaffected.
export function AdminThemeProvider({ children }) {
  return (
    <ThemeProvider storageKey={ADMIN_STORAGE_KEY} applyToDocument={false}>
      {children}
    </ThemeProvider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

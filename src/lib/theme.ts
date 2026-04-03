/**
 * Shared theme constants.
 * CSS custom property references resolve at render time in the browser.
 */

/** HTTP method color map using CSS variable references. */
export const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--color-method-get)',
  POST: 'var(--color-method-post)',
  PUT: 'var(--color-method-put)',
  PATCH: 'var(--color-method-patch)',
  DELETE: 'var(--color-method-delete)',
  HEAD: 'var(--color-method-head)',
  OPTIONS: 'var(--color-method-options)',
  TRACE: 'var(--color-method-trace)',
  CONNECT: 'var(--color-method-connect)',
};

/* ---- Theme switching ---- */

export type ThemeId = 'default' | 'canvas';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
}

export const THEMES: ThemeDefinition[] = [
  { id: 'default', label: 'Default' },
  { id: 'canvas', label: 'Canvas' },
];

const STORAGE_KEY = 'pb-theme';

export function getStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some(t => t.id === stored)) {
      return stored as ThemeId;
    }
  } catch {
    // localStorage may be unavailable
  }
  return 'default';
}

export function applyTheme(themeId: ThemeId): void {
  const html = document.documentElement;
  if (themeId === 'default') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', themeId);
  }
}

export function setTheme(themeId: ThemeId): void {
  applyTheme(themeId);
  try {
    localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // localStorage may be unavailable
  }
}

// Apply stored theme immediately on module load (before Svelte mounts)
applyTheme(getStoredTheme());

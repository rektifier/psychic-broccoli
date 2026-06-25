/**
 * Shared theme constants.
 * CSS custom property references resolve at render time in the browser.
 */

import { readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { appConfigDir, join } from '@tauri-apps/api/path';
import type { Favorite } from './types';

/** Derive a folder's display name from its absolute path (last path segment). */
function pathBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

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

const SETTINGS_FILE = 'settings.json';

interface Settings {
  theme?: ThemeId;
  /**
   * Favorited workspace folders, in insertion order.
   * Stored as `{ path, name }` objects. Legacy bare strings are migrated on load.
   */
  favorites?: (Favorite | string)[];
}

async function getSettingsPath(): Promise<string> {
  const dir = await appConfigDir();
  return join(dir, SETTINGS_FILE);
}

async function readSettings(): Promise<Settings> {
  try {
    const path = await getSettingsPath();
    const content = await readTextFile(path);
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  try {
    const dir = await appConfigDir();
    await mkdir(dir, { recursive: true });
    const path = await join(dir, SETTINGS_FILE);
    await writeTextFile(path, JSON.stringify(settings, null, 2));
  } catch {
    // Settings write failed silently
  }
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
  readSettings().then(settings => {
    writeSettings({ ...settings, theme: themeId });
  });
}

/** Load theme from settings file and apply it. */
export async function loadTheme(): Promise<ThemeId> {
  const settings = await readSettings();
  const themeId = settings.theme && THEMES.some(t => t.id === settings.theme) ? settings.theme : 'default';
  applyTheme(themeId);
  return themeId;
}

/* ---- Favorites ---- */

/** Load the list of favorited workspace folders, migrating legacy bare-string entries. */
export async function loadFavorites(): Promise<Favorite[]> {
  const settings = await readSettings();
  const favorites = settings.favorites;
  if (!Array.isArray(favorites)) return [];
  const result: Favorite[] = [];
  const seen = new Set<string>();
  for (const entry of favorites) {
    // Legacy format: a bare path string. Migrate to { path, name: basename }.
    const fav: Favorite | null =
      typeof entry === 'string'
        ? { path: entry, name: pathBasename(entry) }
        : entry && typeof entry.path === 'string'
          ? { path: entry.path, name: typeof entry.name === 'string' && entry.name ? entry.name : pathBasename(entry.path) }
          : null;
    if (!fav || seen.has(fav.path)) continue;
    seen.add(fav.path);
    result.push(fav);
  }
  return result;
}

/** Persist the list of favorited workspace folders. */
export async function saveFavorites(favorites: Favorite[]): Promise<void> {
  const settings = await readSettings();
  await writeSettings({ ...settings, favorites });
}

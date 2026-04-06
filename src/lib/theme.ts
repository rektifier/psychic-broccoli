/**
 * Shared theme constants.
 * CSS custom property references resolve at render time in the browser.
 */

import { readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { appConfigDir, join } from '@tauri-apps/api/path';

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

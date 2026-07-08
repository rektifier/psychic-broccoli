// ─── Workspace IO ────────────────────────────────────────────────────────────
// Scanning and opening workspace folders: discover .http/.rest files, build
// the workspace tree, auto-load environment files, and discover flows. All
// state lands in the shared stores; UI-owned state (the per-environment Key
// Vault cache in App.svelte) is reached through the KeyVaultHooks callbacks.

import { get } from 'svelte/store';
import { readTextFile, readDir } from '@tauri-apps/plugin-fs';
import { join, basename } from '@tauri-apps/api/path';
import {
  workspace,
  selectedLocation,
  currentResponse,
  currentSentRequest,
  namedResults,
  tabs,
  envFile,
  userEnvFile,
  activeEnvironment,
  flows,
  flowRunHistory,
  flowTabs,
  activeFlowTabPath,
  addToast,
} from './stores';
import { buildWorkspaceTree, parseEnvironmentFile } from './parser';
import type { DiscoveredFile, DiscoveredFolder } from './parser';
import { scanForFlowFiles, loadFlowHistory, migrateFlowsDirectory } from './flowIO';
import type { FlowDefinition } from './types';

/** Callbacks into UI-owned Key Vault state (cache and fetch live in App.svelte). */
export interface KeyVaultHooks {
  /** Clear the per-environment Key Vault cache (called when a folder opens). */
  resetCache(): void;
  /** Kick off a Key Vault secret fetch for the active environment. */
  refresh(): void;
}

// ── Recursively scan a directory for .http/.rest files ──

async function scanDir(
  dir: string,
  rootDir: string,
  emptyFolderSink: DiscoveredFolder[],
): Promise<DiscoveredFile[]> {
  const entries = await readDir(dir);
  const results: DiscoveredFile[] = [];
  let hasHttpDescendant = false;

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = await join(dir, entry.name);
    if (entry.isDirectory) {
      const subFiles = await scanDir(fullPath, rootDir, emptyFolderSink);
      results.push(...subFiles);
      if (subFiles.length > 0) hasHttpDescendant = true;
    } else if (entry.name.endsWith('.http') || entry.name.endsWith('.rest')) {
      const content = await readTextFile(fullPath);
      const relativePath = fullPath.substring(rootDir.length + 1).replaceAll('\\', '/');
      results.push({ absolutePath: fullPath, relativePath, content });
      hasHttpDescendant = true;
    }
  }

  if (!hasHttpDescendant) {
    const relDir = dir.substring(rootDir.length + 1).replaceAll('\\', '/');
    emptyFolderSink.push({ relativePath: relDir });
  }

  return results;
}

export async function scanForHttpFiles(
  rootDir: string,
): Promise<{ files: DiscoveredFile[]; emptyFolders: DiscoveredFolder[] }> {
  const emptyFolders: DiscoveredFolder[] = [];
  const entries = await readDir(rootDir);
  const files: DiscoveredFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = await join(rootDir, entry.name);
    if (entry.isDirectory) {
      const subFiles = await scanDir(fullPath, rootDir, emptyFolders);
      files.push(...subFiles);
    } else if (entry.name.endsWith('.http') || entry.name.endsWith('.rest')) {
      const content = await readTextFile(fullPath);
      const relativePath = fullPath.substring(rootDir.length + 1).replaceAll('\\', '/');
      files.push({ absolutePath: fullPath, relativePath, content });
    }
  }

  return { files, emptyFolders };
}

// ── Auto-discover env files from workspace root ──

export async function tryLoadEnvFiles(rootDir: string) {
  try {
    const envPath = await join(rootDir, 'http-client.env.json');
    const content = await readTextFile(envPath);
    const parsed = parseEnvironmentFile(content);
    if (parsed) {
      envFile.set(parsed);
      const names = Object.keys(parsed).filter((k) => k !== '$shared');
      if (names.length > 0 && !get(activeEnvironment)) activeEnvironment.set(names[0]);
    }
  } catch {
    /* file doesn't exist */
  }

  try {
    const userPath = await join(rootDir, 'http-client.env.json.user');
    const content = await readTextFile(userPath);
    const parsed = parseEnvironmentFile(content);
    if (parsed) userEnvFile.set(parsed);
  } catch {
    /* file doesn't exist */
  }
}

// ── Open a workspace folder ──

export async function openFolderByPath(rootPath: string, keyVault: KeyVaultHooks) {
  const { files: discovered, emptyFolders } = await scanForHttpFiles(rootPath);
  const tree = buildWorkspaceTree(discovered, emptyFolders, rootPath);
  const rootName = await basename(rootPath);

  workspace.set({ rootPath, rootName, tree });
  selectedLocation.set(null);
  currentResponse.set(null);
  namedResults.set({});
  tabs.set([]);
  currentSentRequest.set(null);

  // Reset environment state before loading new env files
  envFile.set(null);
  userEnvFile.set(null);
  keyVault.resetCache();
  activeEnvironment.set(null);

  // Auto-discover env files from workspace root
  await tryLoadEnvFiles(rootPath);
  keyVault.refresh();

  // Migrate legacy flows/ to .flows/ if needed
  try {
    const migrated = await migrateFlowsDirectory(rootPath);
    if (migrated) addToast("Workspace updated: renamed 'flows' to '.flows'", 'info');
  } catch {
    /* best effort */
  }

  // Discover test flows and load run history
  try {
    const discoveredFlows = await scanForFlowFiles(rootPath, rootPath);
    const flowMap: Record<string, FlowDefinition> = {};
    for (const df of discoveredFlows) {
      flowMap[df.relativePath] = df.flow;
    }
    flows.set(flowMap);
  } catch {
    /* no flows yet */
  }

  try {
    const history = await loadFlowHistory(rootPath);
    flowRunHistory.set(history);
  } catch {
    /* no history yet */
  }

  // Reset flow tabs
  flowTabs.set([]);
  activeFlowTabPath.set(null);
}

// ── Path safety ──

/** Validate and join a relative path onto a root, preventing directory traversal. */
export async function safeJoinPath(rootPath: string, relativePath: string): Promise<string> {
  for (const seg of relativePath.split('/')) {
    if (
      !seg ||
      seg === '..' ||
      seg === '.' ||
      seg.includes('\0') ||
      seg.includes('\\') ||
      seg.includes('/')
    ) {
      throw new Error(`Invalid path segment: "${seg}"`);
    }
  }
  return join(rootPath, relativePath);
}

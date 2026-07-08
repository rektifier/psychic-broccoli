// ─── Import IO ───────────────────────────────────────────────────────────────
// Writing imported collections into the workspace and merging imported
// environments into http-client.env.json. Modal visibility stays in
// App.svelte; importCollectionContent returns the discovered variables that
// still need the target-environment modal (empty when nothing is pending).

import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { join, basename, dirname } from '@tauri-apps/api/path';
import { workspace, envFile, activeEnvironment, addToast } from './stores';
import { errorMessage } from './errors';
import type { HttpInvokeResult } from './requestExec';
import { ensureSharedEnvironment } from './envFiles';
import { buildWorkspaceTree } from './workspaceTree';
import { scanForHttpFiles, safeJoinPath } from './workspaceIO';
import { importPostmanCollection } from './postman';
import { importInsomniaExport } from './insomnia';
import { importOpenApiSpec } from './openapi';
import type { ImportFormat } from './detect';
import type { ImportResult, EnvironmentFile, Variable } from './types';

/**
 * Fetch a collection/spec over HTTP (via the Tauri http_request proxy) and
 * return its text body. Throws an Error with a user-facing message on HTTP
 * error statuses or binary responses.
 */
export async function fetchSpecFromUrl(url: string): Promise<string> {
  const res: HttpInvokeResult = await invoke('http_request', {
    payload: {
      method: 'GET',
      url,
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      body: null,
    },
  });

  if (res.status >= 400) {
    throw new Error(`Server returned ${res.status} ${res.status_text}`);
  }

  if (res.body_encoding === 'base64') {
    throw new Error('URL returned binary content, not a text spec');
  }

  return res.body;
}

export async function writeImportedFiles(result: ImportResult): Promise<number> {
  const rootPath = get(workspace).rootPath!;
  let written = 0;
  for (const file of result.files) {
    const outPath = await safeJoinPath(rootPath, file.relativePath);
    const parentDir = await dirname(outPath);
    try {
      await mkdir(parentDir, { recursive: true });
    } catch {
      /* already exists */
    }
    await writeTextFile(outPath, file.content);
    written++;
  }

  // Refresh workspace tree
  const { files: discovered, emptyFolders } = await scanForHttpFiles(rootPath);
  const tree = buildWorkspaceTree(discovered, emptyFolders, rootPath);
  const rootName = await basename(rootPath);
  workspace.set({ rootPath, rootName, tree });

  return written;
}

/** Merge a fully-formed imported environment file into http-client.env.json. */
export async function writeImportedEnvironmentFile(imported: EnvironmentFile) {
  const rootPath = get(workspace).rootPath;
  if (!rootPath) return;
  try {
    const existing = get(envFile);
    const current: EnvironmentFile = ensureSharedEnvironment(
      existing ? structuredClone(existing) : {},
    );

    for (const [envName, vars] of Object.entries(imported)) {
      if (!current[envName]) current[envName] = {};
      for (const [key, value] of Object.entries(vars)) {
        if (typeof value === 'string' && !(key in current[envName])) {
          current[envName][key] = value;
        }
      }
    }

    const envPath = await join(rootPath, 'http-client.env.json');
    await writeTextFile(envPath, JSON.stringify(current, null, 2));
    envFile.set(current);

    const envNames = Object.keys(imported).filter((n) => n !== '$shared');
    if (!get(activeEnvironment) && envNames.length > 0) {
      activeEnvironment.set(envNames[0]);
    }

    addToast(
      `Imported ${envNames.length} environment${envNames.length !== 1 ? 's' : ''}: ${envNames.join(', ')}`,
      'info',
    );
  } catch (e) {
    addToast(`Failed to write environment file: ${errorMessage(e)}`, 'error');
  }
}

/** Add discovered variables to the chosen environment (only keys not already present). */
export async function applyImportedVariables(envName: string, vars: Variable[]) {
  const rootPath = get(workspace).rootPath;
  if (!rootPath || vars.length === 0) return;

  try {
    // Load or create the env file
    const currentEnv: EnvironmentFile = ensureSharedEnvironment(get(envFile) ?? {});

    // Ensure the target environment exists
    if (!currentEnv[envName]) {
      currentEnv[envName] = {};
    }

    // Add discovered variables with their values (only if not already present)
    for (const v of vars) {
      if (!(v.key in currentEnv[envName])) {
        (currentEnv[envName] as Record<string, string>)[v.key] = v.value;
      }
    }

    // Write the env file
    const envPath = await join(rootPath, 'http-client.env.json');
    await writeTextFile(envPath, JSON.stringify(currentEnv, null, 2));

    // Update stores
    envFile.set(currentEnv);
    if (!get(activeEnvironment)) {
      activeEnvironment.set(envName);
    }

    addToast(
      `Added ${vars.length} variable${vars.length !== 1 ? 's' : ''} to "${envName}" environment.`,
      'info',
    );
  } catch (e) {
    addToast(`Failed to update environment file: ${errorMessage(e)}`, 'error');
  }
}

/**
 * Import a collection payload: convert to .http files, write them into the
 * workspace, and merge any imported environment file. Returns the discovered
 * variables that still need an environment target (the caller shows the
 * import-environment modal for them), or [] when nothing is pending.
 */
export async function importCollectionContent(
  content: string,
  format: ImportFormat,
): Promise<Variable[]> {
  if (!get(workspace).rootPath) {
    addToast('Open a workspace folder first before importing.', 'error');
    return [];
  }

  try {
    let result: ImportResult;
    switch (format) {
      case 'postman':
        result = importPostmanCollection(content);
        break;
      case 'insomnia':
        result = importInsomniaExport(content);
        break;
      case 'openapi':
        result = importOpenApiSpec(content);
        break;
    }
    const written = await writeImportedFiles(result);
    addToast(
      `Imported ${written} file${written !== 1 ? 's' : ''} from "${result.collectionName}".`,
      'info',
    );
    // Write the env file directly if multi-env; otherwise hand back the
    // discovered variables so the caller can show the target modal.
    if (result.environmentFile && Object.keys(result.environmentFile).length > 0) {
      await writeImportedEnvironmentFile(result.environmentFile);
      return [];
    }
    return result.discoveredVariables;
  } catch (e) {
    addToast(`Import failed: ${errorMessage(e)}`, 'error');
    return [];
  }
}
